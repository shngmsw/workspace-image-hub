import { randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

import { type AssetId, type AssetRecord, parseAssetId } from "../../shared/domain";
import { HubError } from "../errors";
import type { Logger } from "../log";
import {
  type AssetStore,
  decodeRecord,
  encodeRecord,
  imageKey,
  RecordNotFound,
  recordKey,
  StoreConflict,
} from "./store";

export interface LocalStoreOptions {
  readonly dataDir: string;
  readonly log: Logger;
}

const LIST_CONCURRENCY = 32;

/**
 * Creates the three directories if missing, empties `tmp/`, and probes DATA_DIR once: write a file,
 * hard-link it, unlink both. A read-only or wrongly-owned volume, or a filesystem without hard
 * links (SMB shares, gcsfuse, some Docker Desktop bind mounts), fails at startup with a message
 * naming DATA_DIR instead of failing the first upload.
 */
export async function createLocalStore(options: LocalStoreOptions): Promise<AssetStore> {
  const root = resolve(options.dataDir);
  const imagesDir = join(root, "i");
  const recordsDir = join(root, "r");
  const tmpDir = join(root, "tmp");
  try {
    await mkdir(imagesDir, { recursive: true });
    await mkdir(recordsDir, { recursive: true });
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    const probe = join(tmpDir, `probe-${randomUUID()}`);
    await stage(probe, new Uint8Array([1]));
    await link(probe, `${probe}.link`);
    await unlink(`${probe}.link`);
    await unlink(probe);
  } catch (error) {
    throw new Error(`DATA_DIR ${root} is not usable (needs a writable filesystem with hard links): ${String(error)}`, {
      cause: error,
    });
  }

  const imagePath = (id: AssetId) => join(imagesDir, `${id}.webp`);
  const recordPath = (id: AssetId) => join(recordsDir, `${id}.json`);
  const withLock = keyedMutex();

  /** Write + fsync to a private tmp name, then hard-link: link fails with EEXIST, so it is create-only and atomic. */
  async function createOnly(path: string, key: string, bytes: Uint8Array): Promise<void> {
    const tmp = join(tmpDir, randomUUID());
    try {
      await stage(tmp, bytes);
      await link(tmp, path);
    } catch (error) {
      if (errorCode(error) === "EEXIST") throw new StoreConflict(key);
      throw unavailable(error);
    } finally {
      await rm(tmp, { force: true });
    }
  }

  async function readRecord(id: AssetId): Promise<AssetRecord | null> {
    let raw: string;
    try {
      raw = await readFile(recordPath(id), "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw unavailable(error);
    }
    const record = decodeRecord(raw);
    if (record === null) options.log.log("WARNING", "store.record_undecodable", { key: recordKey(id) });
    return record;
  }

  return {
    putImage: (id, webp) => createOnly(imagePath(id), imageKey(id), webp),

    async openImage(id) {
      let handle;
      try {
        handle = await open(imagePath(id), "r");
      } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw unavailable(error);
      }
      try {
        // Stat the handle, not the path: no race with a concurrent delete.
        const { size } = await handle.stat();
        const body = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
        return { body, size };
      } catch (error) {
        await handle.close();
        throw unavailable(error);
      }
    },

    deleteImage: (id) => removeFile(imagePath(id)),

    createRecord: (record) => createOnly(recordPath(record.id), recordKey(record.id), new TextEncoder().encode(encodeRecord(record))),

    getRecord: readRecord,

    updateRecord: (id, mutate) =>
      withLock(id, async () => {
        const current = await readRecord(id);
        if (current === null) throw new RecordNotFound(id);
        const next = mutate(current);
        const tmp = join(tmpDir, randomUUID());
        try {
          await stage(tmp, new TextEncoder().encode(encodeRecord(next)));
          // rename replaces atomically; safe because the lock excludes deleteRecord for this id.
          await rename(tmp, recordPath(id));
        } catch (error) {
          throw unavailable(error);
        } finally {
          await rm(tmp, { force: true });
        }
        return next;
      }),

    deleteRecord: (id) => withLock(id, () => removeFile(recordPath(id))),

    async listRecords() {
      let names: string[];
      try {
        names = await readdir(recordsDir);
      } catch (error) {
        throw unavailable(error);
      }
      const ids = names.flatMap((name) => {
        const id = name.endsWith(".json") ? parseAssetId(name.slice(0, -".json".length)) : null;
        return id?.ok === true ? [id.value] : [];
      });
      const records: AssetRecord[] = [];
      for (let i = 0; i < ids.length; i += LIST_CONCURRENCY) {
        const batch = await Promise.all(ids.slice(i, i + LIST_CONCURRENCY).map(readRecord));
        for (const record of batch) if (record !== null) records.push(record);
      }
      return records;
    },
  };
}

async function stage(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw unavailable(error);
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function unavailable(error: unknown): HubError {
  return new HubError("storage_unavailable", undefined, { cause: error });
}

function keyedMutex(): <T>(id: AssetId, work: () => Promise<T>) => Promise<T> {
  const tails = new Map<AssetId, Promise<void>>();
  return async (id, work) => {
    const run = (tails.get(id) ?? Promise.resolve()).then(work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(id, tail);
    try {
      return await run;
    } finally {
      if (tails.get(id) === tail) tails.delete(id);
    }
  };
}
