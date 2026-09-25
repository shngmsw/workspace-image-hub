import type { DriveBootConfig } from "../shared/api";
import type { Locale } from "../shared/i18n";
import { GAPI_SCRIPT, GIS_SCRIPT, loadScript } from "./google";
import { DriveDownloadError, type IntakeFile } from "./uploads";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

export interface PickOptions {
  readonly loginHint: string;
  readonly locale: Locale;
  readonly accept: string;
}

let cachedToken: { readonly value: string; readonly expiresAt: number } | null = null;
let pickerReady: Promise<void> | null = null;

/** Loads both scripts ahead of the click, so the click can open the consent popup at once. */
export function preloadDrive(): Promise<void> {
  pickerReady ??= Promise.all([loadScript(GIS_SCRIPT), loadScript(GAPI_SCRIPT)])
    .then(() => new Promise<void>((resolve) => { gapi.load("picker", resolve); }))
    .catch((error: unknown) => {
      pickerReady = null;
      throw error;
    });
  return pickerReady;
}

function requestToken(config: DriveBootConfig, loginHint: string): Promise<string> {
  if (cachedToken !== null && cachedToken.expiresAt - Date.now() > TOKEN_MARGIN_MS) return Promise.resolve(cachedToken.value);
  return new Promise((resolve, reject) => {
    google.accounts.oauth2
      .initTokenClient({
        client_id: config.clientId,
        scope: DRIVE_SCOPE,
        login_hint: loginHint,
        prompt: "",
        callback: (response) => {
          if (response.error !== undefined) {
            reject(new Error(response.error));
            return;
          }
          cachedToken = { value: response.access_token, expiresAt: Date.now() + Number(response.expires_in) * 1000 };
          resolve(response.access_token);
        },
        error_callback: (error) => {
          reject(new Error(error.type));
        },
      })
      .requestAccessToken();
  });
}

/**
 * Resolves with [] when the user closes the Picker or declines consent. Must be called from a
 * click handler: the first call may open the GIS consent popup, which browsers block otherwise.
 * Google-native documents cannot be picked (mime filter), so `alt=media` always applies.
 */
export async function pickFromDrive(config: DriveBootConfig, options: PickOptions): Promise<IntakeFile[]> {
  await preloadDrive();
  let token: string;
  try {
    token = await requestToken(config, options.loginHint);
  } catch {
    return [];
  }
  const docs = await new Promise<readonly google.picker.PickedDoc[]>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS_IMAGES)
      .setMimeTypes(options.accept)
      .setIncludeFolders(true)
      .setEnableDrives(true);
    new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setLocale(options.locale)
      .addView(view)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) resolve(data.docs ?? []);
        else if (data.action === google.picker.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
  return docs.map((doc) => ({
    name: doc.name,
    size: Number(doc.sizeBytes ?? 0),
    source: "drive" as const,
    open: (signal) => download(config, options.loginHint, doc.id, signal),
  }));
}

/**
 * No automatic retry on 401: a fresh token may need the GIS popup, and popups need a user gesture.
 * The row's retry button is that gesture, and retry runs `open` again at once.
 */
async function download(config: DriveBootConfig, loginHint: string, id: string, signal: AbortSignal): Promise<Blob> {
  const token = await requestToken(config, loginHint);
  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new DriveDownloadError("network");
  }
  if (res.status === 401) cachedToken = null;
  if (!res.ok) throw new DriveDownloadError(res.status);
  return res.blob();
}
