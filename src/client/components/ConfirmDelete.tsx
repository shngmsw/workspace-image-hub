import { useEffect, useRef, useState } from "react";

import type { AssetView } from "../../shared/domain";
import { useI18n } from "../i18n";
import { TrashIcon, WarningIcon } from "./icons";

/**
 * A modal <dialog>. The cache warning is part of the question, not small print: a deleted link
 * stops at the origin, but copies already cached downstream keep showing for a while.
 */
export function ConfirmDelete({
  asset,
  onCancel,
  onConfirm,
}: {
  readonly asset: AssetView;
  readonly onCancel: () => void;
  /** Resolves with an error message to show, or null once deleted. */
  readonly onConfirm: () => Promise<string | null>;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-3xl border border-line bg-sheet p-0 text-ink shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)] backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="develop p-6">
        <div className="flex gap-4">
          <div className="checker size-20 shrink-0 overflow-hidden rounded-xl border border-line">
            <img src={asset.url} alt="" className="size-full object-contain" />
          </div>
          <p className="font-display text-xl leading-snug">{t.assets.confirmDelete(asset.originalName)}</p>
        </div>
        <p className="mt-5 flex gap-2.5 rounded-2xl bg-well px-4 py-3 text-[13px] leading-relaxed text-muted">
          <WarningIcon className="mt-0.5 shrink-0 text-base text-accent" />
          {t.assets.deleteCacheWarning}
        </p>
        {error !== null && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-medium transition-colors hover:bg-well disabled:opacity-50"
          >
            {t.assets.cancel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().then((failure) => {
                setBusy(false);
                setError(failure);
              });
            }}
            className="flex items-center gap-2 rounded-full bg-danger px-4 py-2 text-sm font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <TrashIcon />
            {t.assets.delete}
          </button>
        </div>
      </div>
    </dialog>
  );
}
