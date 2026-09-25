import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

import { LOCALE_COOKIE, type Locale, type Messages, messages } from "../shared/i18n";

interface I18n {
  readonly locale: Locale;
  readonly t: Messages;
  readonly setLocale: (locale: Locale) => void;
  readonly formatDate: (iso: string) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ initial, children }: { readonly initial: Locale; readonly children: ReactNode }) {
  const [locale, setLocaleState] = useState(initial);
  const setLocale = useCallback((next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    setLocaleState(next);
  }, []);
  const value = useMemo<I18n>(() => {
    const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    return { locale, t: messages[locale], setLocale, formatDate: (iso) => dates.format(new Date(iso)) };
  }, [locale, setLocale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (value === null) throw new Error("useI18n outside I18nProvider");
  return value;
}
