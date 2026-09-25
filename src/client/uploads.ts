import type { ClientErrorCode, ErrorCode, UploadMeta } from "../shared/api";
import type { AssetSource, AssetView, InputIssue } from "../shared/domain";
import { ApiError, uploadAsset } from "./api";

export interface IntakeFile {
  readonly name: string;
  readonly size: number;
  readonly source: AssetSource;
  readonly open: (signal: AbortSignal) => Promise<Blob>;
}

export function fromLocalFiles(files: Iterable<File>): IntakeFile[] {
  return Array.from(files, (file) => ({
    name: file.name,
    size: file.size,
    source: "upload" as const,
    open: () => Promise.resolve(file),
  }));
}

export class DriveDownloadError extends Error {
  constructor(readonly status: number | "network") {
    super(`drive download failed: ${String(status)}`);
    this.name = "DriveDownloadError";
  }
}

export type UploadStatus =
  | { readonly state: "queued" }
  /** `open()` in flight. Instant for local files; a Drive download otherwise. */
  | { readonly state: "fetching" }
  | { readonly state: "uploading"; readonly loaded: number; readonly total: number }
  /** Every byte sent; the server is decoding and encoding. */
  | { readonly state: "converting" }
  | { readonly state: "done"; readonly asset: AssetView }
  | { readonly state: "failed"; readonly code: ErrorCode | ClientErrorCode; readonly issue?: InputIssue };

export interface UploadItem {
  readonly key: string;
  readonly file: IntakeFile;
  readonly tags: readonly string[];
  readonly status: UploadStatus;
}

export interface UploadQueue {
  enqueue(files: readonly IntakeFile[], tags: readonly string[]): void;
  retry(key: string): void;
  cancel(key: string): void;
  clearFinished(): void;
}

export type Uploader = (
  file: Blob,
  meta: UploadMeta,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
) => Promise<AssetView>;

export interface UploadQueueOptions {
  readonly maxBytes: number;
  readonly onChange: (items: readonly UploadItem[]) => void;
  readonly onUploaded: (asset: AssetView) => void;
  readonly upload?: Uploader;
}

export const UPLOAD_CONCURRENCY = 2;

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const upload = options.upload ?? uploadAsset;
  const controllers = new Map<string, AbortController>();
  let items: readonly UploadItem[] = [];
  let running = 0;
  let sequence = 0;

  const emit = () => {
    options.onChange(items);
  };
  const statusOf = (key: string) => items.find((i) => i.key === key)?.status;
  const set = (key: string, status: UploadStatus) => {
    items = items.map((i) => (i.key === key ? { ...i, status } : i));
    emit();
  };
  const drop = (key: string) => {
    items = items.filter((i) => i.key !== key);
    emit();
  };

  function pump(): void {
    while (running < UPLOAD_CONCURRENCY) {
      const next = [...items].reverse().find((i) => i.status.state === "queued");
      if (next === undefined) return;
      running += 1;
      set(next.key, { state: "fetching" });
      void run(next).finally(() => {
        running -= 1;
        pump();
      });
    }
  }

  async function run(item: UploadItem): Promise<void> {
    const controller = new AbortController();
    controllers.set(item.key, controller);
    try {
      const blob = await item.file.open(controller.signal);
      set(item.key, { state: "uploading", loaded: 0, total: blob.size });
      const meta: UploadMeta = { filename: item.file.name, source: item.file.source, tags: item.tags };
      const asset = await upload(
        blob,
        meta,
        (loaded, total) => {
          if (controller.signal.aborted) return;
          set(item.key, loaded >= total ? { state: "converting" } : { state: "uploading", loaded, total });
        },
        controller.signal,
      );
      set(item.key, { state: "done", asset });
      options.onUploaded(asset);
    } catch (error) {
      if (controller.signal.aborted) drop(item.key);
      else set(item.key, failure(error));
    } finally {
      controllers.delete(item.key);
    }
  }

  return {
    enqueue(files, tags) {
      const added = files.map(
        (file): UploadItem => ({
          key: `u${String((sequence += 1))}`,
          file,
          tags,
          status: file.size > options.maxBytes ? { state: "failed", code: "too_large" } : { state: "queued" },
        }),
      );
      items = [...added.reverse(), ...items];
      emit();
      pump();
    },
    retry(key) {
      if (statusOf(key)?.state !== "failed") return;
      const item = items.find((i) => i.key === key);
      if (item !== undefined && item.file.size > options.maxBytes) return;
      set(key, { state: "queued" });
      pump();
    },
    cancel(key) {
      const controller = controllers.get(key);
      if (controller !== undefined) controller.abort();
      else drop(key);
    },
    clearFinished() {
      items = items.filter((i) => i.status.state !== "done" && i.status.state !== "failed");
      emit();
    },
  };
}

function failure(error: unknown): UploadStatus {
  if (error instanceof ApiError) {
    const issue = error.detail?.["issue"];
    return typeof issue === "string" ? { state: "failed", code: error.code, issue: issue as InputIssue } : { state: "failed", code: error.code };
  }
  if (error instanceof DriveDownloadError) return { state: "failed", code: "drive_download" };
  return { state: "failed", code: "network" };
}
