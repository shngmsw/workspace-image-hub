import { useDeferredValue, useMemo, useState } from "react";

import type { AssetId, AssetView } from "../../shared/domain";
import { type AssetQuery, filterAssets, tagCounts } from "../../shared/query";
import { useI18n } from "../i18n";
import { AssetCard } from "./AssetCard";
import { ConfirmDelete } from "./ConfirmDelete";
import { CloseIcon, SearchIcon } from "./icons";

const PAGE = 120;

export interface LibraryProps {
  readonly assets: readonly AssetView[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly query: AssetQuery;
  readonly onQuery: (query: AssetQuery) => void;
  readonly onSaveTags: (id: AssetId, tags: readonly string[]) => Promise<string | null>;
  readonly onDelete: (id: AssetId) => Promise<string | null>;
}

export function Library({ assets, loading, error, query, onQuery, onSaveTags, onDelete }: LibraryProps) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(PAGE);
  const [deleting, setDeleting] = useState<AssetView | null>(null);
  const deferredQuery = useDeferredValue(query);
  const shown = useMemo(() => filterAssets(assets, deferredQuery), [assets, deferredQuery]);
  const tags = useMemo(() => tagCounts(assets), [assets]);
  const filtered = query.text.trim() !== "" || query.tagKeys.length > 0;

  const toggleTag = (key: string) => {
    onQuery({ ...query, tagKeys: query.tagKeys.includes(key) ? query.tagKeys.filter((k) => k !== key) : [...query.tagKeys, key] });
  };

  return (
    <section className="mt-12" aria-labelledby="library-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h2 id="library-heading" className="font-display text-4xl leading-none tracking-[-0.01em]">
          {t.assets.heading}
        </h2>
        <p className="font-mono text-xs text-muted">{t.assets.count(shown.length, assets.length)}</p>
      </div>

      <div className="sticky top-[57px] z-20 -mx-4 mt-5 border-b border-line/60 bg-paper/85 px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border sm:px-3">
        <div className="flex items-center gap-2">
          <label className="relative flex-1">
            <span className="sr-only">{t.assets.searchPlaceholder}</span>
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query.text}
              onChange={(e) => {
                onQuery({ ...query, text: e.currentTarget.value });
              }}
              placeholder={t.assets.searchPlaceholder}
              className="w-full rounded-full border border-line bg-sheet py-2.5 pl-10 pr-4 text-sm placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
          </label>
          {filtered && (
            <button
              type="button"
              onClick={() => {
                onQuery({ text: "", tagKeys: [] });
              }}
              className="flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-xs text-muted transition-colors hover:bg-well hover:text-ink"
            >
              <CloseIcon /> {t.assets.clearFilters}
            </button>
          )}
        </div>
        {tags.length > 0 && (
          <ul className="-mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {tags.map(({ key, tag, count }) => {
              const active = query.tagKeys.includes(key);
              return (
                <li key={key} className="shrink-0">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      toggleTag(key);
                    }}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                      active ? "border-accent bg-accent text-accent-ink" : "border-line bg-sheet hover:border-accent/60"
                    }`}
                  >
                    {tag}
                    <span className={`font-mono text-[10px] ${active ? "text-accent-ink/80" : "text-muted"}`}>{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="mt-6 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-10 font-mono text-xs text-muted">{t.assets.loading}</p>
      ) : shown.length === 0 ? (
        <div className="mt-8 grid place-items-center rounded-[26px] border border-dashed border-line px-6 py-16 text-center">
          <p className="font-display text-2xl text-muted">{assets.length === 0 ? t.assets.empty : t.assets.noMatches}</p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shown.slice(0, limit).map((asset, index) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                index={index}
                activeTagKeys={query.tagKeys}
                onToggleTag={toggleTag}
                onSaveTags={(next) => onSaveTags(asset.id, next)}
                onDelete={() => {
                  setDeleting(asset);
                }}
              />
            ))}
          </div>
          {shown.length > limit && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setLimit((l) => l + PAGE);
                }}
                className="rounded-full border border-line bg-sheet px-5 py-2.5 text-sm font-medium transition-colors hover:bg-well"
              >
                {t.assets.showMore}
              </button>
            </div>
          )}
        </>
      )}

      {deleting !== null && (
        <ConfirmDelete
          asset={deleting}
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={async () => {
            const failure = await onDelete(deleting.id);
            if (failure === null) setDeleting(null);
            return failure;
          }}
        />
      )}
    </section>
  );
}
