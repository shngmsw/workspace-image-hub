import type { AuthErrorCode, ClientErrorCode, ErrorCode } from "./api";
import type { AssetView, InputIssue } from "./domain";
import { TAG_MAX_CHARS, TAGS_MAX } from "./domain";
import type { SnippetKind } from "./snippets";

export type Locale = "ja" | "en";
export const LOCALES: readonly Locale[] = ["ja", "en"];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "wih_locale";

export function parseLocale(raw: string | null | undefined): Locale | null {
  return LOCALES.find((l) => l === raw) ?? null;
}

export function negotiateLocale(input: {
  readonly pinned: Locale | null;
  readonly cookie: string | undefined;
  readonly acceptLanguage: string | undefined;
}): Locale {
  if (input.pinned !== null) return input.pinned;
  const fromCookie = parseLocale(input.cookie);
  if (fromCookie !== null) return fromCookie;
  const ranked = (input.acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [range = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { primary: range.trim().toLowerCase().split("-")[0], q: q === undefined ? 1 : Number(q.slice(2)), index };
    })
    .filter((r) => Number.isFinite(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const r of ranked) {
    const locale = parseLocale(r.primary);
    if (locale !== null) return locale;
  }
  return DEFAULT_LOCALE;
}

export interface Messages {
  readonly signIn: {
    readonly tagline: string;
    readonly hint: (domains: string) => string;
    readonly signingIn: string;
    readonly unavailable: string;
    readonly errors: Readonly<Record<AuthErrorCode, string>>;
  };
  readonly header: {
    readonly signOut: string;
    readonly language: string;
    readonly admin: string;
  };
  readonly upload: {
    readonly queueHeading: string;
    readonly dropHere: string;
    readonly browse: string;
    readonly pasteHint: string;
    readonly fromDrive: string;
    readonly batchTags: string;
    readonly batchTagsPlaceholder: string;
    readonly limits: (maxMb: number, maxDimension: number) => string;
    readonly queued: string;
    readonly fetchingFromDrive: string;
    readonly uploading: (percent: number) => string;
    readonly converting: string;
    readonly retry: string;
    readonly cancel: string;
    readonly dismiss: string;
    readonly clearFinished: string;
    readonly reduction: (from: string, to: string, percent: number) => string;
    readonly grew: (from: string, to: string, percent: number) => string;
  };
  readonly copy: {
    readonly labels: Readonly<Record<SnippetKind, string>>;
    readonly short: Readonly<Record<SnippetKind, string>>;
    readonly copied: string;
    readonly failed: string;
  };
  readonly assets: {
    readonly heading: string;
    readonly count: (shown: number, total: number) => string;
    readonly searchPlaceholder: string;
    readonly clearFilters: string;
    readonly empty: string;
    readonly noMatches: string;
    readonly showMore: string;
    readonly loading: string;
    readonly uploadedBy: (name: string, date: string) => string;
    readonly fromDrive: string;
    readonly animated: string;
    readonly editTags: string;
    readonly tagsPlaceholder: string;
    readonly save: string;
    readonly cancel: string;
    readonly delete: string;
    readonly confirmDelete: (name: string) => string;
    readonly deleteCacheWarning: string;
  };
  readonly errors: Readonly<Record<ErrorCode | ClientErrorCode, string>>;
  readonly inputIssues: Readonly<Record<InputIssue, string>>;
}

export const en: Messages = {
  signIn: {
    tagline: "Drop an image, get a fast WebP link that never breaks.",
    hint: (domains) => `Sign in with your ${domains} Google account.`,
    signingIn: "Signing in…",
    unavailable: "The Google sign-in button could not load. Check your connection or browser extensions, then reload.",
    errors: {
      not_allowed: "This Google account is not allowed here. Choose your work account.",
      email_unverified: "The email address of this Google account is not verified.",
      login_failed: "Sign-in failed. Please try again.",
    },
  },
  header: { signOut: "Sign out", language: "Language", admin: "Admin" },
  upload: {
    queueHeading: "Uploads",
    dropHere: "Drop images here, or",
    browse: "choose files",
    pasteHint: "You can also paste an image.",
    fromDrive: "Import from Google Drive",
    batchTags: "Tags for new uploads",
    batchTagsPlaceholder: "e.g. ChatIcon, Sales",
    limits: (maxMb, maxDimension) => `Up to ${maxMb} MB per file. Saved as WebP, long edge at most ${maxDimension} px.`,
    queued: "Waiting…",
    fetchingFromDrive: "Downloading from Drive…",
    uploading: (percent) => `Uploading ${percent}%`,
    converting: "Converting to WebP…",
    retry: "Retry",
    cancel: "Cancel",
    dismiss: "Dismiss",
    clearFinished: "Clear finished",
    reduction: (from, to, percent) => `${from} → ${to} (${percent}% smaller)`,
    grew: (from, to, percent) => `${from} → ${to} (${percent}% larger)`,
  },
  copy: {
    labels: { url: "Copy URL", markdown: "Copy Markdown" },
    short: { url: "URL", markdown: "Markdown" },
    copied: "Copied",
    failed: "Could not copy",
  },
  assets: {
    heading: "Library",
    count: (shown, total) => (shown === total ? `${total} images` : `${shown} of ${total} images`),
    searchPlaceholder: "Search file names, tags, uploaders",
    clearFilters: "Clear",
    empty: "No images yet. Drop one above.",
    noMatches: "No images match.",
    showMore: "Show more",
    loading: "Loading…",
    uploadedBy: (name, date) => `${name} · ${date}`,
    fromDrive: "Drive",
    animated: "Animated",
    editTags: "Edit tags",
    tagsPlaceholder: "Comma-separated tags",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    confirmDelete: (name) => `Delete “${name}”? Every place that embeds this link will show a broken image.`,
    deleteCacheWarning:
      "The link stops working at the source right away, but copies already cached by browsers, Google Chat, GitHub, Notion, or a CDN can keep showing for a while.",
  },
  errors: {
    unauthenticated: "Your session has ended. Sign in again.",
    forbidden: "Only the uploader or an admin can delete this image.",
    cross_origin: "Blocked: the request did not come from this app.",
    not_found: "This image no longer exists.",
    invalid_input: "Some of the input is invalid.",
    too_large: "The file is larger than the upload limit.",
    unsupported_format: "This file type is not supported. Use JPEG, PNG, WebP, GIF, AVIF or TIFF.",
    too_many_pixels: "The image has too many pixels to process.",
    corrupt_image: "The image could not be read. The file may be damaged.",
    storage_unavailable: "Storage is unavailable. Try again shortly.",
    internal: "Something went wrong on the server.",
    network: "Network error. Check your connection and retry.",
    drive_download: "Could not download this file from Google Drive.",
  },
  inputIssues: {
    asset_id_malformed: "Malformed image id.",
    tag_empty: "Tags cannot be empty.",
    tag_too_long: `A tag can be at most ${TAG_MAX_CHARS} characters.`,
    tag_forbidden_char: "Tags cannot contain “,” or “#”.",
    too_many_tags: `An image can have at most ${TAGS_MAX} tags.`,
    source_unknown: "Unknown upload source.",
    body_malformed: "Malformed request.",
  },
};

export const ja: Messages = {
  signIn: {
    tagline: "画像をドロップするだけで、崩れない WebP 直リンクを発行します。",
    hint: (domains) => `${domains} の Google アカウントでログインしてください。`,
    signingIn: "ログインしています…",
    unavailable: "Google のログインボタンを読み込めませんでした。接続やブラウザ拡張機能を確認してから再読み込みしてください。",
    errors: {
      not_allowed: "この Google アカウントは利用を許可されていません。組織のアカウントを選んでください。",
      email_unverified: "この Google アカウントのメールアドレスは確認されていません。",
      login_failed: "ログインに失敗しました。もう一度お試しください。",
    },
  },
  header: { signOut: "ログアウト", language: "言語", admin: "管理者" },
  upload: {
    queueHeading: "アップロード",
    dropHere: "画像をここにドロップ、または",
    browse: "ファイルを選択",
    pasteHint: "画像の貼り付けにも対応しています。",
    fromDrive: "Google ドライブから取り込む",
    batchTags: "アップロード時に付けるタグ",
    batchTagsPlaceholder: "例: ChatIcon, 営業部",
    limits: (maxMb, maxDimension) => `1 ファイル ${maxMb} MB まで。WebP に変換し、長辺 ${maxDimension}px 以内に縮小します。`,
    queued: "待機中…",
    fetchingFromDrive: "ドライブから取得中…",
    uploading: (percent) => `アップロード中 ${percent}%`,
    converting: "WebP に変換中…",
    retry: "再試行",
    cancel: "キャンセル",
    dismiss: "閉じる",
    clearFinished: "完了分を消去",
    reduction: (from, to, percent) => `${from} → ${to}（${percent}% 削減）`,
    grew: (from, to, percent) => `${from} → ${to}（${percent}% 増加）`,
  },
  copy: {
    labels: { url: "直リンクをコピー", markdown: "Markdown をコピー" },
    short: { url: "URL", markdown: "Markdown" },
    copied: "コピー済み",
    failed: "コピーできませんでした",
  },
  assets: {
    heading: "ライブラリ",
    count: (shown, total) => (shown === total ? `${total} 枚` : `${total} 枚中 ${shown} 枚`),
    searchPlaceholder: "ファイル名・タグ・登録者で検索",
    clearFilters: "解除",
    empty: "まだ画像がありません。上の枠にドロップしてください。",
    noMatches: "一致する画像はありません。",
    showMore: "さらに表示",
    loading: "読み込み中…",
    uploadedBy: (name, date) => `${name}・${date}`,
    fromDrive: "ドライブ",
    animated: "アニメーション",
    editTags: "タグを編集",
    tagsPlaceholder: "タグをカンマ区切りで入力",
    save: "保存",
    cancel: "キャンセル",
    delete: "削除",
    confirmDelete: (name) => `「${name}」を削除しますか？ このリンクを使っている場所では画像が表示されなくなります。`,
    deleteCacheWarning:
      "配信元からはすぐに消えますが、ブラウザや Google Chat、GitHub、Notion、CDN にキャッシュされたコピーはしばらく表示されることがあります。",
  },
  errors: {
    unauthenticated: "セッションが切れました。もう一度ログインしてください。",
    forbidden: "この画像を削除できるのは、登録した本人と管理者だけです。",
    cross_origin: "このアプリ以外から送られたリクエストのため拒否しました。",
    not_found: "この画像はすでに存在しません。",
    invalid_input: "入力内容に誤りがあります。",
    too_large: "ファイルがアップロード上限を超えています。",
    unsupported_format: "対応していない形式です。JPEG・PNG・WebP・GIF・AVIF・TIFF を使ってください。",
    too_many_pixels: "画素数が多すぎるため処理できません。",
    corrupt_image: "画像を読み込めませんでした。ファイルが壊れている可能性があります。",
    storage_unavailable: "ストレージに接続できません。しばらくしてから再試行してください。",
    internal: "サーバーでエラーが発生しました。",
    network: "通信エラーです。接続を確認して再試行してください。",
    drive_download: "Google ドライブからファイルを取得できませんでした。",
  },
  inputIssues: {
    asset_id_malformed: "画像 ID の形式が正しくありません。",
    tag_empty: "空のタグは付けられません。",
    tag_too_long: `タグは ${TAG_MAX_CHARS} 文字以内にしてください。`,
    tag_forbidden_char: "タグに「,」と「#」は使えません。",
    too_many_tags: `タグは 1 枚につき ${TAGS_MAX} 個までです。`,
    source_unknown: "アップロード元が不明です。",
    body_malformed: "リクエストの形式が正しくありません。",
  },
};

export const messages: Readonly<Record<Locale, Messages>> = { en, ja };

export function formatBytes(bytes: number, locale: Locale): string {
  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit > 0 && value < 10 ? 1 : 0;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return `${number} ${units[unit] ?? "B"}`;
}

// Rounded down so a large saving never reads as 100% while bytes remain.
export function savedPercent(originalBytes: number, storedBytes: number): number {
  return originalBytes === 0 ? 0 : Math.floor(((originalBytes - storedBytes) * 100) / originalBytes);
}

export function formatSizeChange(originalBytes: number, storedBytes: number, locale: Locale): string {
  const m = messages[locale].upload;
  const from = formatBytes(originalBytes, locale);
  const to = formatBytes(storedBytes, locale);
  if (storedBytes <= originalBytes || originalBytes === 0) return m.reduction(from, to, savedPercent(originalBytes, storedBytes));
  return m.grew(from, to, Math.round((storedBytes / originalBytes - 1) * 100));
}

export function formatDimensions(asset: Pick<AssetView, "width" | "height" | "originalSize">): string {
  const stored = `${asset.width}×${asset.height}`;
  const original = asset.originalSize;
  if (original === null || (original.width === asset.width && original.height === asset.height)) return stored;
  return `${original.width}×${original.height} → ${stored}`;
}
