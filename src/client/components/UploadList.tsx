import { formatBytes, formatSizeChange } from "../../shared/i18n";
import { useI18n } from "../i18n";
import type { UploadItem, UploadQueue } from "../uploads";
import { CopyButtons } from "./CopyButtons";
import { CheckIcon, CloseIcon, DriveIcon, RetryIcon, WarningIcon } from "./icons";

export function UploadList({ items, queue }: { readonly items: readonly UploadItem[]; readonly queue: UploadQueue }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  const finished = items.some((i) => i.status.state === "done" || i.status.state === "failed");

  return (
    <section aria-label={t.upload.queueHeading} className="mt-6">
      <ol className="flex flex-col gap-2.5">
        {items.map((item) => (
          <UploadRow key={item.key} item={item} queue={queue} />
        ))}
      </ol>
      {finished && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => {
              queue.clearFinished();
            }}
            className="rounded-full px-3 py-1 text-xs text-muted transition-colors hover:bg-well hover:text-ink"
          >
            {t.upload.clearFinished}
          </button>
        </div>
      )}
    </section>
  );
}

function UploadRow({ item, queue }: { readonly item: UploadItem; readonly queue: UploadQueue }) {
  const { t, locale } = useI18n();
  const { status, file } = item;
  const done = status.state === "done" ? status.asset : null;

  let line: string;
  let progress: number | "converting" | null = null;
  switch (status.state) {
    case "queued":
      line = t.upload.queued;
      progress = 0;
      break;
    case "fetching":
      line = file.source === "drive" ? t.upload.fetchingFromDrive : t.upload.queued;
      progress = 0;
      break;
    case "uploading": {
      const percent = status.total === 0 ? 0 : Math.floor((status.loaded / status.total) * 100);
      line = t.upload.uploading(percent);
      progress = percent;
      break;
    }
    case "converting":
      line = t.upload.converting;
      progress = "converting";
      break;
    case "done":
      line = formatSizeChange(status.asset.originalBytes, status.asset.storedBytes, locale);
      break;
    case "failed":
      line = status.issue === undefined ? t.errors[status.code] : t.inputIssues[status.issue];
      break;
  }

  return (
    <li
      className={`develop grid grid-cols-[3.5rem_1fr_auto] items-center gap-x-3.5 gap-y-2.5 rounded-2xl border bg-sheet p-2.5 pr-3 sm:grid-cols-[3.5rem_1fr_auto_minmax(0,21rem)] ${
        status.state === "failed" ? "border-danger/40" : "border-line"
      }`}
    >
      <div className="checker relative size-14 overflow-hidden rounded-xl border border-line">
        {done !== null ? (
          <img src={done.url} alt="" className="develop absolute inset-0 size-full object-contain" />
        ) : (
          <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase text-muted">
            {file.source === "drive" ? <DriveIcon className="text-lg" /> : (file.name.split(".").pop() ?? "").slice(0, 4)}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={file.name}>
          {file.name}
        </p>
        <p
          className={`mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] ${
            status.state === "failed" ? "text-danger" : status.state === "done" ? "text-ok" : "text-muted"
          }`}
          aria-live="polite"
        >
          {status.state === "done" && <CheckIcon className="shrink-0" />}
          {status.state === "failed" && <WarningIcon className="shrink-0" />}
          <span className="truncate">{line}</span>
          {status.state !== "done" && status.state !== "failed" && <span className="text-muted/70">· {formatBytes(file.size, locale)}</span>}
        </p>
        {progress !== null && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-well">
            {progress === "converting" ? (
              <div className="converting h-full w-full" />
            ) : (
              <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${String(progress)}%` }} />
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 self-start sm:self-center">
        {status.state === "failed" && status.code !== "too_large" && (
          <button
            type="button"
            onClick={() => {
              queue.retry(item.key);
            }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-well"
          >
            <RetryIcon /> {t.upload.retry}
          </button>
        )}
        <button
          type="button"
          aria-label={status.state === "done" || status.state === "failed" ? t.upload.dismiss : t.upload.cancel}
          title={status.state === "done" || status.state === "failed" ? t.upload.dismiss : t.upload.cancel}
          onClick={() => {
            queue.cancel(item.key);
          }}
          className="grid size-7 place-items-center rounded-full text-muted transition-colors hover:bg-well hover:text-ink"
        >
          <CloseIcon />
        </button>
      </div>

      {done !== null && (
        <div className="col-span-3 sm:col-span-1">
          <CopyButtons asset={done} />
        </div>
      )}
    </li>
  );
}
