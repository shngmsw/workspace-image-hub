import { useState } from "react";

import type { BootUser } from "../../shared/api";
import { signOut } from "../api";
import { useI18n } from "../i18n";
import { LanguageToggle } from "./LanguageToggle";
import { Mark, SignOutIcon } from "./icons";

export function Header({ appName, user, localeFixed }: { readonly appName: string; readonly user: BootUser; readonly localeFixed: boolean }) {
  const { t } = useI18n();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const initial = (user.name.trim()[0] ?? user.email[0] ?? "?").toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Mark className="shrink-0 text-[26px]" />
        <span className="truncate font-display text-[26px] leading-none tracking-[-0.01em]">{appName}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {!localeFixed && <LanguageToggle />}
          <div className="flex items-center gap-2" title={user.email}>
            {user.picture !== null && !avatarFailed ? (
              <img
                src={user.picture}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => {
                  setAvatarFailed(true);
                }}
                className="size-8 rounded-full border border-line object-cover"
              />
            ) : (
              <span className="grid size-8 place-items-center rounded-full bg-ink text-xs font-semibold text-paper">{initial}</span>
            )}
            <span className="hidden max-w-40 truncate text-sm md:inline">{user.name}</span>
            {user.isAdmin && (
              <span className="hidden rounded-full border border-accent/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent sm:inline">
                {t.header.admin}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label={t.header.signOut}
            title={t.header.signOut}
            onClick={() => {
              void signOut().then(() => {
                location.reload();
              });
            }}
            className="flex items-center gap-1.5 rounded-full p-2 text-sm text-muted transition-colors hover:bg-well hover:text-ink sm:px-3 sm:py-1.5"
          >
            <SignOutIcon className="text-base sm:hidden" />
            <span className="hidden sm:inline">{t.header.signOut}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
