import { type ReactElement, useEffect, useState } from "react";

import type { AssetView } from "../../shared/domain";
import { SNIPPET_KINDS, type SnippetKind, snippet } from "../../shared/snippets";
import { copyText } from "../clipboard";
import { useI18n } from "../i18n";
import { ChatIcon, CheckIcon, LinkIcon, MarkdownIcon } from "./icons";

const ICONS: Readonly<Record<SnippetKind, (props: { className?: string }) => ReactElement>> = {
  url: LinkIcon,
  chat: ChatIcon,
  markdown: MarkdownIcon,
};

export function CopyButtons({ asset, size = "sm" }: { readonly asset: Pick<AssetView, "url" | "originalName">; readonly size?: "sm" | "md" }) {
  const { t } = useI18n();
  const [done, setDone] = useState<{ readonly kind: SnippetKind; readonly ok: boolean } | null>(null);

  useEffect(() => {
    if (done === null) return;
    const timer = setTimeout(() => {
      setDone(null);
    }, 1600);
    return () => {
      clearTimeout(timer);
    };
  }, [done]);

  const copy = (kind: SnippetKind) => {
    copyText(snippet(kind, asset)).then(
      () => {
        setDone({ kind, ok: true });
      },
      () => {
        setDone({ kind, ok: false });
      },
    );
  };

  const pad = size === "md" ? "px-3 py-2 text-[13px]" : "px-2.5 py-1.5 text-xs";
  return (
    <div className="@container flex w-full overflow-hidden rounded-full border border-line bg-paper/60" role="group">
      {SNIPPET_KINDS.map((kind) => {
        const Glyph = ICONS[kind];
        const confirmed = done?.kind === kind;
        return (
          <button
            key={kind}
            type="button"
            title={t.copy.labels[kind]}
            aria-label={t.copy.labels[kind]}
            onClick={() => {
              copy(kind);
            }}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-line font-medium transition-colors not-first:border-l hover:bg-accent-soft hover:text-ink active:scale-[0.98] ${pad} ${
              confirmed ? (done.ok ? "bg-accent text-accent-ink hover:bg-accent hover:text-accent-ink" : "bg-danger-soft text-danger") : "text-ink/85"
            }`}
          >
            {confirmed && done.ok ? <CheckIcon className="shrink-0" /> : <Glyph className="hidden shrink-0 opacity-70 @[19rem]:block" />}
            <span className="truncate">{confirmed ? (done.ok ? t.copy.copied : t.copy.failed) : t.copy.short[kind]}</span>
          </button>
        );
      })}
      <span className="sr-only" aria-live="polite">
        {done?.ok === true ? t.copy.copied : ""}
      </span>
    </div>
  );
}
