import { useEffect, useRef, useState } from "react";

import type { SignedOutBoot } from "../../shared/api";
import { signIn } from "../api";
import { renderSignInButton } from "../google";
import { useI18n } from "../i18n";
import { LanguageToggle } from "./LanguageToggle";
import { Mark, WarningIcon } from "./icons";

function cleanUrl(): string {
  const url = new URL(location.href);
  url.searchParams.delete("auth_error");
  return `${url.pathname}${url.search}`;
}

export function SignIn({ appName, session, localeFixed }: { readonly appName: string; readonly session: SignedOutBoot; readonly localeFixed: boolean }) {
  const { t, locale } = useI18n();
  const button = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "signing-in" | "unavailable">("loading");

  useEffect(() => {
    const parent = button.current;
    if (parent === null) return;
    parent.replaceChildren();
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    renderSignInButton(parent, session.signIn, {
      locale,
      dark,
      onCredential: (credential) => {
        setPhase("signing-in");
        void signIn(credential).then((refusal) => {
          const next = new URL(cleanUrl(), location.origin);
          if (refusal !== null) next.searchParams.set("auth_error", refusal);
          location.replace(next);
        });
      },
    }).then(
      () => {
        setPhase("ready");
      },
      () => {
        setPhase("unavailable");
      },
    );
  }, [session.signIn, locale]);

  const domains = session.signIn.allowedDomains.map((d) => `@${d}`).join(", ");

  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <span className="flex items-center gap-2 text-sm font-medium tracking-tight">
          <Mark className="text-[22px]" />
          {appName}
        </span>
        {!localeFixed && <LanguageToggle />}
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-12 px-5 pb-16 sm:px-8 md:grid-cols-[1.1fr_1fr]">
        <section className="develop">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-accent">WebP · direct links</p>
          <h1 className="mt-4 font-display text-[clamp(3rem,9vw,5.5rem)] leading-[0.92] tracking-[-0.02em]">{appName}</h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted">{t.signIn.tagline}</p>

          <div className="mt-9 flex min-h-[44px] flex-col items-start gap-3">
            {/* The GIS iframe document is light; a dark color-scheme on its element makes the browser paint it opaque white. */}
            <div ref={button} style={{ colorScheme: "light" }} className={phase === "signing-in" ? "pointer-events-none opacity-40" : ""} />
            {phase === "loading" && <div className="h-[44px] w-[280px] animate-pulse rounded-full bg-well" />}
            {phase === "signing-in" && <p className="font-mono text-xs text-muted">{t.signIn.signingIn}</p>}
            {phase === "unavailable" && <p className="max-w-sm text-sm text-danger">{t.signIn.unavailable}</p>}
          </div>

          {domains !== "" && <p className="mt-5 max-w-md text-pretty font-mono text-xs leading-relaxed text-muted">{t.signIn.hint(domains)}</p>}

          {session.authError !== null && (
            <p role="alert" className="mt-6 flex max-w-md items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <WarningIcon className="mt-0.5 shrink-0 text-base" />
              {t.signIn.errors[session.authError]}
            </p>
          )}
        </section>

        <ContactSheet />
      </main>
    </div>
  );
}

function ContactSheet() {
  return (
    <div aria-hidden="true" className="relative mx-auto hidden aspect-square w-full max-w-sm md:block">
      <Frame className="left-[4%] top-[10%] -rotate-[7deg]" tone="from-[#e9a47c] via-[#c75b3b] to-[#3c2a3f]" caption="logo-final.png" size="3.5 MB" delay="0.1s" />
      <Frame className="right-[2%] top-[4%] rotate-[5deg]" tone="from-[#9bb7a5] via-[#4d7d6d] to-[#1f3237]" caption="team-photo.jpg" size="6.1 MB" delay="0.25s" />
      <Frame className="bottom-[4%] left-[22%] rotate-[-1deg] ring-2 ring-accent" tone="from-[#f2d27a] via-[#e0763f] to-[#6e2f3a]" caption="7k2m9q4x.webp" size="210 KB" delay="0.4s" accent />
    </div>
  );
}

function Frame(props: {
  readonly className: string;
  readonly tone: string;
  readonly caption: string;
  readonly size: string;
  readonly delay: string;
  readonly accent?: boolean;
}) {
  return (
    <figure
      className={`develop absolute w-[58%] rounded-md bg-sheet p-2.5 pb-3 shadow-[0_18px_40px_-18px_rgba(30,20,10,0.45)] ${props.className}`}
      style={{ animationDelay: props.delay }}
    >
      <div className={`aspect-[4/3] rounded-[3px] bg-gradient-to-br ${props.tone}`} />
      <figcaption className="mt-2 flex justify-between font-mono text-[10px] text-muted">
        <span>{props.caption}</span>
        <span className={props.accent === true ? "text-accent" : ""}>{props.size}</span>
      </figcaption>
    </figure>
  );
}
