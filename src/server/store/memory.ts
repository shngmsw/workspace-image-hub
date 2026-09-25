import type { AssetId } from "../../shared/domain";
import { HubError } from "../errors";
import type { Logger } from "../log";
import {
  type AssetStore,
  CAS_ATTEMPTS,
  decodeRecord,
  encodeRecord,
  imageKey,
  RecordNotFound,
  recordKey,
  StoreConflict,
} from "./store";

export type MemoryWriteOp = "putImage" | "createRecord" | "updateRecord" | "deleteImage" | "deleteRecord";

export interface MemoryStoreOptions {
  readonly beforeCommit?: (op: MemoryWriteOp, key: string) => Promise<void>;
  readonly records?: Map<string, string>;
  readonly log?: Logger;
}

export function createMemoryStore(options: MemoryStoreOptions = {}): AssetStore {
  const images = new Map<AssetId, Uint8Array>();
  const records = options.records ?? new Map<string, string>();
  const beforeCommit = options.beforeCommit ?? (() => Promise.resolve());

  return {
    async putImage(id, webp) {
      await beforeCommit("putImage", imageKey(id));
      if (images.has(id)) throw new StoreConflict(imageKey(id));
      images.set(id, webp.slice());
    },

    openImage(id) {
      const bytes = images.get(id);
      if (bytes === undefined) return Promise.resolve(null);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice());
          controller.close();
        },
      });
      return Promise.resolve({ body, size: bytes.byteLength });
    },

    async deleteImage(id) {
      await beforeCommit("deleteImage", imageKey(id));
      images.delete(id);
    },

    async createRecord(record) {
      await beforeCommit("createRecord", recordKey(record.id));
      if (records.has(record.id)) throw new StoreConflict(recordKey(record.id));
      records.set(record.id, encodeRecord(record));
    },

    getRecord(id) {
      const raw = records.get(id);
      return Promise.resolve(raw === undefined ? null : decodeRecord(raw));
    },

    async updateRecord(id, mutate) {
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const raw = records.get(id);
        const current = raw === undefined ? null : decodeRecord(raw);
        if (current === null) throw new RecordNotFound(id);
        const next = mutate(current);
        await beforeCommit("updateRecord", recordKey(id));
        const now = records.get(id);
        if (now === undefined) throw new RecordNotFound(id);
        if (now !== raw) continue;
        records.set(id, encodeRecord(next));
        return next;
      }
      throw new HubError("storage_unavailable", { reason: "cas_exhausted" });
    },

    async deleteRecord(id) {
      await beforeCommit("deleteRecord", recordKey(id));
      records.delete(id);
    },

    listRecords() {
      const list = [];
      for (const [id, raw] of records) {
        const record = decodeRecord(raw);
        if (record === null) options.log?.log("WARNING", "store.record_undecodable", { id });
        else list.push(record);
      }
      return Promise.resolve(list);
    },
  };
}
