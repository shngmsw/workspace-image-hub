/**
 * The whole UI: one screen, two states (signed out / signed in). No client router: the only URL
 * state is `?q=&tag=` (search) and `?auth_error=` (a refused sign-in).
 *
 *   App
 *   ├─ SignIn        Google Identity Services button, allowed-domain hint, refusal message
 *   └─ Dashboard
 *      ├─ Header     app name, language toggle (hidden if APP_LOCALE pins it), user, sign out
 *      ├─ Intake     drop anywhere / file dialog / paste / Drive, with batch tags
 *      ├─ UploadList progress, converting, "3.5 MB → 210 KB (94% smaller)" + copy, or error + retry
 *      └─ Library    search + tag filter over the catalog; AssetCard: copy, edit tags, delete
 */

import type { BootConfig } from "../shared/api";
import { Dashboard } from "./components/Dashboard";
import { SignIn } from "./components/SignIn";
import { I18nProvider } from "./i18n";

export function App({ boot }: { readonly boot: BootConfig }) {
  return (
    <I18nProvider initial={boot.locale}>
      {boot.session.state === "signed-in" ? (
        <Dashboard boot={boot} session={boot.session} />
      ) : (
        <SignIn appName={boot.appName} session={boot.session} localeFixed={boot.localeFixed} />
      )}
    </I18nProvider>
  );
}
