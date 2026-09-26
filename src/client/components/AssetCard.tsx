import { useId, useState } from "react";

import type { AssetView } from "../../shared/domain";
import { parseTags, tagKey } from "../../shared/domain";
import { formatBytes, formatDimensions } from "../../shared/i18n";
import { useI18n } from "../i18n";
import { splitTags } from "../tags";
import { CopyButtons } from "./CopyButtons";
import { TagIcon, TrashIcon } from "./icons";

export interface AssetCardProps {
  readonly asset: AssetView;
  readonly index: number;
  readonly activeTagKeys: readonly string[];
  readonly onToggleTag: (key: string) => void;
  readonly onSaveTags: (tags: readonly string[]) => Promise<string | null>;
  readonly onDelete: () => void;
}

export function AssetCard({ asset, index, activeTagKeys, onToggleTag, onSaveTags, onDelete }: AssetCardProps) {
  const { t, locale, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const saved = asset.originalBytes === 0 ? 0 : Math.round((1 - asset.storedBytes / asset.originalBytes) * 100);

  const save = () => {
    const tags = splitTags(draft);
    const parsed = parseTags(tags);
    if (!parsed.ok) {
      setError(t.inputIssues[parsed.issue]);
      return;
    }
    setSaving(true);
    void onSaveTags(tags).then((failure) => {
      setSaving(false);
      if (failure === null) setEditing(false);
      else setError(failure);
    });
  };

  return (
    <article
      className="develop group flex flex-col overflow-hidden rounded-[20px] border border-line bg-sheet shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-28px_rgba(40,25,10,0.55)]"
      style={{ animationDelay: `${String(Math.min(index, 12) * 35)}ms` }}
    >
      <a href={asset.url} target="_blank" rel="noreferrer" className="checker relative block aspect-[4/3] border-b border-line">
        <img
          src={asset.url}
          alt={asset.originalName}
          loading="lazy"
          decoding="async"
          width={asset.width}
          height={asset.height}
          className="absolute inset-0 size-full object-contain p-3 transition-transform duration-500 group-hover:scale-[1.02]"
        />
        <span className="absolute bottom-2 left-2.5 whitespace-nowrap rounded-full bg-paper/85 px-2 py-0.5 font-mono text-[10px] text-muted backdrop-blur-sm">
          {formatDimensions(asset)}
        </span>
        <span className="absolute right-2 top-2 flex gap-1">
          {asset.animated && <Badge>{t.assets.animated}</Badge>}
          {asset.source === "drive" && <Badge>{t.assets.fromDrive}</Badge>}
        </span>
      </a>

      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.005em]" title={asset.originalName}>
            {asset.originalName}
          </h3>
          <p className="mt-0.5 font-mono text-[11px] text-muted">
            {formatBytes(asset.storedBytes, locale)}
            {saved > 0 && <span className="text-accent"> · −{saved}%</span>}
            <span className="text-muted/70"> · {t.assets.uploadedBy(asset.uploadedBy.name, formatDate(asset.createdAt))}</span>
          </p>
        </div>

        {editing ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="sr-only">
              {t.assets.editTags}
            </label>
            <input
              id={inputId}
              autoFocus
              value={draft}
              placeholder={t.assets.tagsPlaceholder}
              onChange={(e) => {
                setDraft(e.currentTarget.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              className="rounded-xl border border-line bg-paper px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            {error !== null && <p className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                }}
                className="rounded-full px-3 py-1 text-xs hover:bg-well"
              >
                {t.assets.cancel}
              </button>
              <button type="button" disabled={saving} onClick={save} className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-paper disabled:opacity-50">
                {t.assets.save}
              </button>
            </div>
          </div>
        ) : (
          asset.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {asset.tags.map((tag) => {
                const key = tagKey(tag);
                const active = activeTagKeys.includes(key);
                return (
                  <li key={key}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        onToggleTag(key);
                      }}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                        active ? "border-accent bg-accent text-accent-ink" : "border-line text-ink/80 hover:border-accent/60"
                      }`}
                    >
                      {tag}
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <CopyButtons asset={asset} />
          <div className="flex items-center justify-end gap-1 text-muted">
            <button
              type="button"
              onClick={() => {
                setDraft(asset.tags.join(", "));
                setError(null);
                setEditing(true);
              }}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors hover:bg-well hover:text-ink"
            >
              <TagIcon />
              {t.assets.editTags}
            </button>
            {asset.canDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <TrashIcon />
                {t.assets.delete}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Badge({ children }: { readonly children: string }) {
  return <span className="rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-paper">{children}</span>;
}
