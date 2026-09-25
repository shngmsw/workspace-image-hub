/**
 * Loading Google's browser scripts, and the Sign in with Google button. Both scripts come from
 * origins the server's CSP lists (app.ts `contentSecurityPolicy`).
 */

import type { GoogleSignInBoot } from "../shared/api";
import type { Locale } from "../shared/i18n";

export const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
export const GAPI_SCRIPT = "https://apis.google.com/js/api.js";

const loading = new Map<string, Promise<void>>();

/** Adds the script once; later calls share the same promise. A failed load can be retried. */
export function loadScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing !== undefined) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      loading.delete(src);
      script.remove();
      reject(new Error(`could not load ${src}`));
    };
    document.head.append(script);
  });
  loading.set(src, promise);
  return promise;
}

/**
 * Renders the GIS button into `parent`. The nonce binds the resulting ID token to the HttpOnly
 * cookie the server set with this page; `hd` only narrows Google's account chooser.
 */
export async function renderSignInButton(
  parent: HTMLElement,
  config: GoogleSignInBoot,
  options: { readonly locale: Locale; readonly dark: boolean; readonly onCredential: (credential: string) => void },
): Promise<void> {
  await loadScript(GIS_SCRIPT);
  google.accounts.id.initialize({
    client_id: config.clientId,
    nonce: config.nonce,
    ...(config.hostedDomain === null ? {} : { hd: config.hostedDomain }),
    ux_mode: "popup",
    context: "signin",
    itp_support: true,
    use_fedcm_for_button: true,
    callback: (response) => {
      options.onCredential(response.credential);
    },
  });
  google.accounts.id.renderButton(parent, {
    type: "standard",
    theme: options.dark ? "filled_black" : "outline",
    size: "large",
    text: "signin_with",
    shape: "pill",
    logo_alignment: "left",
    width: 280,
    locale: options.locale,
  });
}
