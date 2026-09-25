import {
  type AuthErrorCode,
  type ErrorBody,
  type ErrorCode,
  type ListAssetsResponse,
  parseAuthErrorCode,
  ROUTES,
  type SignInFailure,
  type SignInRequest,
  type UpdateAssetBody,
  UPLOAD_META_HEADER,
  type UploadMeta,
  encodeUploadMeta,
} from "../shared/api";
import { type AssetId, type AssetView, type InputIssue, parseInputIssue } from "../shared/domain";

type Detail = Readonly<Record<string, string | number>>;

export class ApiError extends Error {
  readonly issue: InputIssue | null;

  constructor(
    readonly code: ErrorCode,
    detail?: Detail,
  ) {
    super(code);
    this.name = "ApiError";
    this.issue = parseInputIssue(detail?.["issue"]);
  }
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorFrom(status: number, text: string): ApiError {
  const body = (tryParseJson(text) ?? {}) as Partial<ErrorBody>;
  const code = body.error?.code ?? (status === 401 ? "unauthenticated" : "internal");
  if (code === "unauthenticated") location.reload();
  return new ApiError(code, body.error?.detail);
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { credentials: "same-origin", ...init });
  if (!res.ok) throw errorFrom(res.status, await res.text());
  return res;
}

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

export async function listAssets(): Promise<ListAssetsResponse["assets"]> {
  const res = await call(ROUTES.listAssets.path);
  return ((await res.json()) as ListAssetsResponse).assets;
}

export function uploadAsset(
  file: Blob,
  meta: UploadMeta,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<AssetView> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ROUTES.uploadAsset.method, ROUTES.uploadAsset.path);
    xhr.setRequestHeader(UPLOAD_META_HEADER, encodeUploadMeta(meta));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    };
    xhr.upload.onload = () => {
      onProgress(file.size, file.size);
    };
    xhr.onload = () => {
      if (xhr.status === 201) resolve(JSON.parse(xhr.responseText) as AssetView);
      else reject(errorFrom(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => {
      reject(new TypeError("network"));
    };
    xhr.onabort = () => {
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", () => {
      xhr.abort();
    });
    xhr.send(file);
  });
}

export async function updateAsset(id: AssetId, body: UpdateAssetBody): Promise<AssetView> {
  const res = await call(ROUTES.updateAsset.path.replace(":id", id), { method: "PATCH", ...json(body) });
  return (await res.json()) as AssetView;
}

export async function deleteAsset(id: AssetId): Promise<void> {
  await call(ROUTES.deleteAsset.path.replace(":id", id), { method: "DELETE" });
}

export async function signIn(credential: string): Promise<AuthErrorCode | null> {
  const res = await fetch(ROUTES.signIn.path, { method: "POST", credentials: "same-origin", ...json({ credential } satisfies SignInRequest) });
  if (res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as Partial<SignInFailure>;
  return parseAuthErrorCode(body.authError) ?? "login_failed";
}

export async function signOut(): Promise<void> {
  await fetch(ROUTES.logout.path, { method: "POST", credentials: "same-origin" });
}
