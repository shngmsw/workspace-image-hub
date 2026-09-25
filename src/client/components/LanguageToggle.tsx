import { LOCALES } from "../../shared/i18n";
import { useI18n } from "../i18n";

const LABELS = { ja: "日本語", en: "EN" } as const;

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t.header.language} className="flex rounded-full border border-line bg-sheet p-0.5 text-xs">
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() => {
            setLocale(l);
          }}
          className={`rounded-full px-2.5 py-1 font-medium transition-colors ${l === locale ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
