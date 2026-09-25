import { describe, expect, it } from "vitest";

import type { AssetId, AssetView } from "../shared/domain";
import { ApiError } from "./api";
import { assetsReducer, initialAssets } from "./catalog";
import { createUploadQueue, DriveDownloadError, type IntakeFile, type Uploader, type UploadItem } from "./uploads";

const asset = (id: string) => ({ id: id as AssetId }) as AssetView;

function file(name: string, size = 10, open?: IntakeFile["open"]): IntakeFile {
  return { name, size, source: "upload", open: open ?? (() => Promise.resolve(new Blob([new Uint8Array(size)]))) };
}

function harness(upload: Uploader, maxBytes = 1000) {
  const states: string[][] = [];
  let items: readonly UploadItem[] = [];
  const uploaded: AssetView[] = [];
  const queue = createUploadQueue({
    maxBytes,
    upload,
    onChange: (next) => {
      items = next;
      states.push(next.map((i) => `${i.file.name}:${i.status.state}`));
    },
    onUploaded: (a) => uploaded.push(a),
  });
  return { queue, states, uploaded, items: () => items };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("upload queue", () => {
  it("walks fetching -> uploading -> converting -> done and reports the asset once", async () => {
    let finish: (a: AssetView) => void = () => undefined;
    const h = harness((blob, meta, onProgress) => {
      expect(meta).toEqual({ filename: "a.png", source: "upload", tags: ["x"] });
      onProgress(4, blob.size);
      onProgress(blob.size, blob.size);
      return new Promise((resolve) => (finish = resolve));
    });
    h.queue.enqueue([file("a.png")], ["x"]);
    await settle();
    expect(h.items()[0]?.status.state).toBe("converting");
    finish(asset("aaaaaaaaaaaaaaaa"));
    await settle();
    expect(h.states.map((s) => s[0])).toEqual(["a.png:queued", "a.png:fetching", "a.png:uploading", "a.png:uploading", "a.png:converting", "a.png:done"]);
    expect(h.uploaded.map((a) => a.id)).toEqual(["aaaaaaaaaaaaaaaa"]);
  });

  it("refuses an oversized file without a request, and never retries it", async () => {
    let calls = 0;
    const h = harness(() => {
      calls += 1;
      return Promise.resolve(asset("x"));
    }, 5);
    h.queue.enqueue([file("big.png", 6)], []);
    h.queue.retry(h.items()[0]?.key ?? "");
    await settle();
    expect(h.items()[0]?.status).toEqual({ state: "failed", code: "too_large" });
    expect(calls).toBe(0);
  });

  it("maps server, Drive and network failures, and retries on demand", async () => {
    let attempt = 0;
    const h = harness(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new ApiError("invalid_input", { issue: "tag_too_long" }));
      if (attempt === 2) return Promise.reject(new TypeError("network"));
      return Promise.resolve(asset("bbbbbbbbbbbbbbbb"));
    });
    h.queue.enqueue([file("a.png"), file("d.png", 10, () => Promise.reject(new DriveDownloadError(403)))], []);
    await settle();
    await settle();
    const byName = (name: string) => h.items().find((i) => i.file.name === name);
    expect(byName("a.png")?.status).toEqual({ state: "failed", code: "invalid_input", issue: "tag_too_long" });
    expect(byName("d.png")?.status).toEqual({ state: "failed", code: "drive_download" });

    h.queue.retry(byName("a.png")?.key ?? "");
    await settle();
    expect(byName("a.png")?.status).toEqual({ state: "failed", code: "network" });
    h.queue.retry(byName("a.png")?.key ?? "");
    await settle();
    expect(byName("a.png")?.status.state).toBe("done");

    h.queue.clearFinished();
    expect(h.items()).toEqual([]);
  });

  it("runs at most two uploads at once and cancels a queued one without sending it", async () => {
    const started: string[] = [];
    const h = harness((_blob, meta) => {
      started.push(meta.filename);
      return new Promise(() => undefined);
    });
    h.queue.enqueue([file("1.png"), file("2.png"), file("3.png")], []);
    await settle();
    expect(started).toEqual(["1.png", "2.png"]);
    const third = h.items().find((i) => i.file.name === "3.png");
    h.queue.cancel(third?.key ?? "");
    expect(h.items().map((i) => i.file.name)).toEqual(["2.png", "1.png"]);
  });
});

describe("assetsReducer", () => {
  it("starts loading when the boot payload had no catalog, then applies server-confirmed changes", () => {
    let state = initialAssets(null);
    expect(state.loading).toBe(true);
    state = assetsReducer(state, { type: "loaded", assets: [asset("a")] });
    state = assetsReducer(state, { type: "uploaded", asset: asset("b") });
    expect(state.assets.map((a) => a.id)).toEqual(["b", "a"]);
    state = assetsReducer(state, { type: "removed", id: "a" as AssetId });
    expect(state.assets.map((a) => a.id)).toEqual(["b"]);
    expect(initialAssets([asset("z")]).loading).toBe(false);
  });
});
