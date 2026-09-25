import { describe, expect, it } from "vitest";

import { animatedGif, photoPng, solidPng } from "../../test/fixtures";
import { type AssetId, parseFileName, parseTags, type Tag } from "../shared/domain";
import { snippet } from "../shared/snippets";
import { mintActorForTest } from "./auth.testing";
import type { HubError } from "./errors";
import { createHub } from "./hub";
import { createTranscoder } from "./image";
import type { Logger } from "./log";
import { createMemoryStore, type MemoryStoreOptions } from "./store/memory";

const quiet: Logger = { log() {} };
const alice = mintActorForTest({ email: "alice@example.com", name: "Alice" });
const bob = mintActorForTest({ email: "bob@example.com" });
const admin = mintActorForTest({ email: "admin@example.com", isAdmin: true });
const noTags: readonly Tag[] = [];

function setup(options: MemoryStoreOptions & { newId?: () => AssetId; now?: () => Date } = {}) {
  const store = createMemoryStore(options);
  const hub = createHub({
    store,
    transcode: createTranscoder({ maxDimension: 1024, quality: 80, maxInputPixels: 100_000_000 }),
    publicBaseUrl: "https://img.example.com/i",
    log: quiet,
    ...(options.newId ? { newId: options.newId } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { store, hub };
}

function tags(...raw: string[]): readonly Tag[] {
  const parsed = parseTags(raw);
  if (!parsed.ok) throw new Error(parsed.issue);
  return parsed.value;
}

describe("hub.ingest", () => {
  it("turns an animated GIF into an animated WebP inside the long-edge cap", async () => {
    const { hub } = setup();
    const view = await hub.ingest(alice, {
      bytes: await animatedGif(1600, 400, 4),
      originalName: parseFileName("C:\\Users\\alice\\spinner.gif"),
      source: "upload",
      tags: noTags,
    });

    expect(view.animated).toBe(true);
    expect([view.width, view.height]).toEqual([1024, 256]);
    expect(view.originalName).toBe("spinner.gif");
    expect(view.url).toBe(`https://img.example.com/i/${view.id}.webp`);
    expect(snippet("markdown", view)).toBe(`![spinner.gif](https://img.example.com/i/${view.id}.webp)`);
    expect(view.uploadedBy).toEqual({ email: "alice@example.com", name: "Alice" });
    expect(view.canDelete).toBe(true);
  });

  it("records original and stored sizes, and the stored bytes are what the store serves", async () => {
    const { hub, store } = setup();
    const png = await photoPng(3000, 2000);
    const view = await hub.ingest(alice, { bytes: png, originalName: parseFileName("photo.png"), source: "drive", tags: tags("ChatIcon") });

    expect(view.originalBytes).toBe(png.byteLength);
    expect(view.storedBytes).toBeLessThan(view.originalBytes);
    expect(view.source).toBe("drive");
    expect(view.tags).toEqual(["ChatIcon"]);
    const image = await store.openImage(view.id);
    expect(image?.size).toBe(view.storedBytes);
    await image?.body.cancel();
  });

  it("rejects SVG by content even when named .png, and writes nothing", async () => {
    const { hub } = setup();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    await expect(
      hub.ingest(alice, { bytes: svg, originalName: parseFileName("logo.png"), source: "upload", tags: noTags }),
    ).rejects.toMatchObject({ code: "unsupported_format", detail: { format: "svg" } } satisfies Partial<HubError>);
    expect(await hub.list(alice)).toEqual([]);
  });

  it("takes a fresh id when the first one is already taken", async () => {
    const taken = "0000000000000000" as AssetId;
    const fresh = "1111111111111111" as AssetId;
    const ids = [taken, taken, fresh];
    const { hub } = setup({ newId: () => ids.shift() ?? fresh });
    const png = await solidPng(10, 10);
    const first = await hub.ingest(alice, { bytes: png, originalName: parseFileName("a.png"), source: "upload", tags: noTags });
    const second = await hub.ingest(alice, { bytes: png, originalName: parseFileName("b.png"), source: "upload", tags: noTags });
    expect([first.id, second.id]).toEqual([taken, fresh]);
  });

  it("leaves no listed asset when the record write fails after the image write", async () => {
    const { hub } = setup({
      beforeCommit: (op) => (op === "createRecord" ? Promise.reject(new Error("crash")) : Promise.resolve()),
    });
    const png = await solidPng(10, 10);
    await expect(hub.ingest(alice, { bytes: png, originalName: parseFileName("a.png"), source: "upload", tags: noTags })).rejects.toThrow("crash");
    expect(await hub.list(alice)).toEqual([]);
  });
});

describe("hub.list and hub.update", () => {
  it("lists newest first and lets any member replace the tags", async () => {
    const times = [new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z")];
    const { hub } = setup({ now: () => times.shift() ?? new Date("2026-04-01T00:00:00Z") });
    const png = await solidPng(10, 10);
    const older = await hub.ingest(alice, { bytes: png, originalName: parseFileName("old.png"), source: "upload", tags: noTags });
    const newer = await hub.ingest(alice, { bytes: png, originalName: parseFileName("new.png"), source: "upload", tags: noTags });

    expect((await hub.list(bob)).map((v) => v.id)).toEqual([newer.id, older.id]);
    expect((await hub.list(bob)).every((v) => !v.canDelete)).toBe(true);

    const edited = await hub.update(bob, older.id, { tags: tags("営業部", "ChatIcon") });
    expect(edited.tags).toEqual(["営業部", "ChatIcon"]);
    expect(edited.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(edited.createdAt).toBe(older.createdAt);
  });

  it("reports not_found when editing a deleted asset and does not resurrect it", async () => {
    const { hub } = setup();
    const view = await hub.ingest(alice, { bytes: await solidPng(10, 10), originalName: parseFileName("a.png"), source: "upload", tags: noTags });
    await hub.remove(alice, view.id);
    await expect(hub.update(bob, view.id, { tags: tags("x") })).rejects.toMatchObject({ code: "not_found" });
    expect(await hub.list(alice)).toEqual([]);
  });
});

describe("hub.remove", () => {
  it("allows the uploader and admins, forbids other members, and is idempotent", async () => {
    const { hub, store } = setup();
    const png = await photoPng(3000, 1000);
    const a = await hub.ingest(alice, { bytes: png, originalName: parseFileName("a.png"), source: "upload", tags: noTags });
    const b = await hub.ingest(alice, { bytes: png, originalName: parseFileName("b.png"), source: "upload", tags: noTags });

    await expect(hub.remove(bob, a.id)).rejects.toMatchObject({ code: "forbidden" });
    await hub.remove(alice, a.id);
    await hub.remove(alice, a.id);
    await hub.remove(admin, b.id);
    expect(await hub.list(alice)).toEqual([]);
    expect(await store.openImage(a.id)).toBeNull();
  });
});
