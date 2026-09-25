/**
 * The AssetStore contract (store.ts), run against every driver. A driver is correct iff it passes
 * this suite; hub.ts relies on nothing else. The GCS run needs a real bucket and runs only when
 * GCS_TEST_BUCKET is set (a scratch bucket; the suite deletes what it writes).
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Storage } from "@google-cloud/storage";
import { describe, expect, it } from "vitest";

import {
  type AssetId,
  type AssetRecord,
  type Email,
  isoTimestamp,
  newAssetId,
  parseFileName,
  parseTags,
} from "../../shared/domain";
import type { Logger } from "../log";
import { createGcsStore, RECORD_METADATA_KEY } from "./gcs";
import { createLocalStore } from "./local";
import { createMemoryStore } from "./memory";
import { type AssetStore, RecordNotFound, recordKey, StoreConflict } from "./store";

interface Harness {
  readonly store: AssetStore;
  /** Writes a record the codec cannot decode, the way a hand edit or a future version might. */
  readonly plantUndecodable: (id: AssetId) => Promise<void>;
  readonly warnings: string[];
}

function capture(): { log: Logger; warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, log: { log: (severity, message) => severity === "WARNING" && warnings.push(message) } };
}

function sampleRecord(id: AssetId, tags: readonly string[] = []): AssetRecord {
  const parsed = parseTags(tags);
  if (!parsed.ok) throw new Error(parsed.issue);
  const at = isoTimestamp(new Date("2026-01-01T00:00:00Z"));
  return {
    v: 1,
    id,
    tags: parsed.value,
    originalName: parseFileName("logo.png"),
    source: "upload",
    width: 10,
    height: 10,
    frames: 1,
    originalBytes: 100,
    storedBytes: 10,
    uploadedBy: { email: "alice@example.com" as Email, name: "Alice" },
    createdAt: at,
    updatedAt: at,
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Element-wise toEqual on megabytes takes seconds; Buffer.equals is a memcmp. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);
}

export function describeAssetStoreContract(name: string, make: () => Promise<Harness>): void {
  describe(`AssetStore contract: ${name}`, () => {
    it("putImage is create-only: a second put of the same id throws StoreConflict and the first bytes survive", async () => {
      const { store } = await make();
      const id = newAssetId();
      await store.putImage(id, new Uint8Array([1, 2, 3]));
      await expect(store.putImage(id, new Uint8Array([9]))).rejects.toBeInstanceOf(StoreConflict);
      const image = await store.openImage(id);
      expect(image && (await readAll(image.body))).toEqual(new Uint8Array([1, 2, 3]));
      await store.deleteImage(id);
    });

    it("createRecord is create-only in the same way", async () => {
      const { store } = await make();
      const id = newAssetId();
      await store.createRecord(sampleRecord(id, ["first"]));
      await expect(store.createRecord(sampleRecord(id, ["second"]))).rejects.toBeInstanceOf(StoreConflict);
      expect((await store.getRecord(id))?.tags).toEqual(["first"]);
      await store.deleteRecord(id);
    });

    it("openImage returns null for a missing id, and the exact bytes and size otherwise", async () => {
      const { store } = await make();
      const id = newAssetId();
      expect(await store.openImage(id)).toBeNull();
      const bytes = new Uint8Array(randomBytes(70_000));
      await store.putImage(id, bytes);
      const image = await store.openImage(id);
      expect(image?.size).toBe(bytes.byteLength);
      expect(image && sameBytes(await readAll(image.body), bytes)).toBe(true);
      await store.deleteImage(id);
      expect(await store.openImage(id)).toBeNull();
    });

    it("a reader never observes a partial image (read in a loop while a large put commits)", async () => {
      const { store } = await make();
      const id = newAssetId();
      const bytes = new Uint8Array(randomBytes(8 * 1024 * 1024));
      const put = { done: false };
      const putting = store.putImage(id, bytes).finally(() => (put.done = true));
      const seen: number[] = [];
      while (!put.done) {
        const image = await store.openImage(id);
        if (image !== null) seen.push((await readAll(image.body)).byteLength);
      }
      await putting;
      const image = await store.openImage(id);
      expect(image && sameBytes(await readAll(image.body), bytes)).toBe(true);
      expect(seen.every((n) => n === bytes.byteLength)).toBe(true);
      await store.deleteImage(id);
    });

    it("deleteImage and deleteRecord resolve for ids that never existed (idempotent)", async () => {
      const { store } = await make();
      await expect(store.deleteImage(newAssetId())).resolves.toBeUndefined();
      await expect(store.deleteRecord(newAssetId())).resolves.toBeUndefined();
    });

    it("updateRecord after deleteRecord throws RecordNotFound and does not recreate the record", async () => {
      const { store } = await make();
      const id = newAssetId();
      await store.createRecord(sampleRecord(id));
      await store.deleteRecord(id);
      await expect(store.updateRecord(id, (r) => r)).rejects.toBeInstanceOf(RecordNotFound);
      expect(await store.getRecord(id)).toBeNull();
      expect((await store.listRecords()).some((r) => r.id === id)).toBe(false);
    });

    it("two concurrent updateRecord calls both apply, in some order (CAS; no lost update)", async () => {
      const { store } = await make();
      const id = newAssetId();
      await store.createRecord(sampleRecord(id));
      const addTag = (tag: string) => (r: AssetRecord) => sampleRecord(r.id, [...r.tags, tag]);
      await Promise.all([store.updateRecord(id, addTag("a")), store.updateRecord(id, addTag("b"))]);
      expect([...((await store.getRecord(id))?.tags ?? [])].sort()).toEqual(["a", "b"]);
      await store.deleteRecord(id);
    });

    it("listRecords includes every completed createRecord, excludes deleted ones", async () => {
      const { store } = await make();
      const [a, b, c] = [newAssetId(), newAssetId(), newAssetId()];
      for (const id of [a, b, c]) await store.createRecord(sampleRecord(id));
      await store.deleteRecord(b);
      const ids = (await store.listRecords()).map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([a, c]));
      expect(ids).not.toContain(b);
      await store.deleteRecord(a);
      await store.deleteRecord(c);
    });

    it("listRecords skips and logs a record that fails decodeRecord instead of failing", async () => {
      const { store, plantUndecodable, warnings } = await make();
      const [good, bad] = [newAssetId(), newAssetId()];
      await store.createRecord(sampleRecord(good));
      await plantUndecodable(bad);
      const ids = (await store.listRecords()).map((r) => r.id);
      expect(ids).toContain(good);
      expect(ids).not.toContain(bad);
      expect(warnings).toContain("store.record_undecodable");
      await store.deleteRecord(good);
      await store.deleteRecord(bad);
    });
  });
}

describeAssetStoreContract("memory", () => {
  const { log, warnings } = capture();
  const records = new Map<string, string>();
  const store = createMemoryStore({ records, log });
  return Promise.resolve({ store, warnings, plantUndecodable: (id) => Promise.resolve(void records.set(id, '{"v":99}')) });
});

describeAssetStoreContract("local", async () => {
  const { log, warnings } = capture();
  const dataDir = await mkdtemp(join(tmpdir(), "wih-"));
  const store = await createLocalStore({ dataDir, log });
  return { store, warnings, plantUndecodable: (id) => writeFile(join(dataDir, "r", `${id}.json`), "{ not json") };
});

const gcsBucket = process.env["GCS_TEST_BUCKET"];
if (gcsBucket !== undefined) {
  describeAssetStoreContract("gcs", async () => {
    const { log, warnings } = capture();
    const storage = new Storage();
    const store = await createGcsStore({ bucket: gcsBucket, publicBucket: null, log, storage });
    const plantUndecodable = async (id: AssetId) => {
      await storage
        .bucket(gcsBucket)
        .file(recordKey(id))
        .save(Buffer.alloc(0), { resumable: false, metadata: { metadata: { [RECORD_METADATA_KEY]: "!!" } } });
    };
    return { store, warnings, plantUndecodable };
  });
}
