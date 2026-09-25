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
