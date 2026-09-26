declare namespace google.accounts.id {
  interface CredentialResponse {
    readonly credential: string;
  }
  interface IdConfiguration {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    nonce?: string;
    hd?: string;
    ux_mode?: "popup" | "redirect";
    context?: "signin" | "signup" | "use";
    itp_support?: boolean;
    use_fedcm_for_button?: boolean;
  }
  interface GsiButtonConfiguration {
    type?: "standard" | "icon";
    theme?: "outline" | "filled_blue" | "filled_black";
    size?: "large" | "medium" | "small";
    text?: "signin_with" | "signup_with" | "continue_with" | "signin";
    shape?: "rectangular" | "pill" | "circle" | "square";
    logo_alignment?: "left" | "center";
    width?: number;
    locale?: string;
  }
  function initialize(config: IdConfiguration): void;
  function renderButton(parent: HTMLElement, options: GsiButtonConfiguration): void;
  function disableAutoSelect(): void;
}

declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    readonly access_token: string;
    readonly expires_in: number | string;
    readonly error?: string;
  }
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    login_hint?: string;
    prompt?: "" | "none" | "consent" | "select_account";
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { readonly type: string }) => void;
  }
  interface TokenClient {
    requestAccessToken(overrides?: { prompt?: TokenClientConfig["prompt"] }): void;
  }
  function initTokenClient(config: TokenClientConfig): TokenClient;
}

declare namespace google.picker {
  interface PickedDoc {
    readonly id: string;
    readonly name: string;
    readonly mimeType: string;
    readonly sizeBytes?: number | string;
  }
  interface ResponseObject {
    readonly action: string;
    readonly docs?: readonly PickedDoc[];
  }
  const Action: { readonly PICKED: string; readonly CANCEL: string };
  const ViewId: { readonly DOCS: string };
  const Feature: { readonly MULTISELECT_ENABLED: string; readonly SUPPORT_DRIVES: string };
  class DocsView {
    constructor(viewId?: string);
    setMimeTypes(mimeTypes: string): DocsView;
    setIncludeFolders(include: boolean): DocsView;
    setEnableDrives(enable: boolean): DocsView;
    setParent(parentId: string): DocsView;
    setOwnedByMe(me: boolean): DocsView;
  }
  interface Picker {
    setVisible(visible: boolean): void;
  }
  class PickerBuilder {
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    setAppId(appId: string): PickerBuilder;
    setLocale(locale: string): PickerBuilder;
    addView(view: DocsView): PickerBuilder;
    enableFeature(feature: string): PickerBuilder;
    setCallback(callback: (data: ResponseObject) => void): PickerBuilder;
    build(): Picker;
  }
}

declare namespace gapi {
  function load(api: string, callback: () => void): void;
}
