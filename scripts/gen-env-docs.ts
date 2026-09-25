/**
 * `pnpm gen:env-docs` writes `.env.example`, and the env tables between `<!-- env:start -->` and
 * `<!-- env:end -->` in README.md / README.ja.md when those files carry the markers, all from
 * `ENV_VARS`. `--check` writes nothing and fails on any difference, so CI keeps the docs honest.
 * `ENV_DOCS_JA` is keyed by EnvName, so a variable without a Japanese description is a compile error.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ENV_VARS, type EnvGroup, type EnvName, type EnvVarSpec } from "../src/server/config";

export const ENV_DOCS_JA: Readonly<Record<EnvName, string>> = {
  APP_URL: "アプリの公開オリジン（例: https://img.example.com）。パスは付けない。OAuth クライアントの「承認済みの JavaScript 生成元」にも登録する。",
  APP_NAME: "画面とページタイトルに表示する名前。",
  APP_LOCALE: "auto | ja | en。auto は利用者の言語切り替え、次に Accept-Language で決める。",
  PORT: "待ち受けポート。Cloud Run は 8080 を渡す。",
  AUTH_SECRET: "32 文字以上。セッション Cookie の署名に使う。`openssl rand -base64 32` で生成する。",
  GOOGLE_CLIENT_ID: "OAuth 2.0 ウェブクライアント ID（<プロジェクト番号>-<ハッシュ>.apps.googleusercontent.com）。「Google でログイン」ボタンと Drive ピッカーが使う。",
  ALLOWED_DOMAINS: "Google Workspace のドメインをカンマ区切りで指定（例: example.com,example.co.jp）。管理対象アカウント（ID トークンに hd がある）で、hd かメールのドメインが完全一致すれば通す。個人の Google アカウントはドメイン指定では通らない。",
  ALLOWED_EMAILS: "個別に許可するアドレスをカンマ区切りで指定（どの Google アカウントでも可）。ALLOWED_DOMAINS と ALLOWED_EMAILS の少なくとも一方が必要。",
  ADMIN_EMAILS: "すべての画像を削除できるメンバーをカンマ区切りで指定。それ以外の人は自分の画像だけ削除できる。",
  SESSION_TTL_HOURS: "セッションの有効時間（1〜720 時間）。Workspace で停止された人もこの時間までは使える。許可リストから外せば次のリクエストで締め出される。",
  GOOGLE_PICKER_API_KEY: "Picker API と APP_URL のリファラーに制限したブラウザ用 API キー。未設定なら Drive ボタンを出さない。",
  GOOGLE_PROJECT_NUMBER: "Picker 用の Cloud プロジェクト番号。未設定なら GOOGLE_CLIENT_ID から求める。",
  STORAGE_DRIVER: "local | gcs。local は Cloud Run では使えない（ディスクが消えるため）。",
  DATA_DIR: "local ドライバの保存先。ハードリンクが使えるファイルシステムが必要。Docker イメージは /data（ボリューム）を指定済み。",
  GCS_BUCKET: "記録（メタデータ）用の非公開バケット。GCS_PUBLIC_BUCKET が無ければ画像もここに置く。",
  GCS_PUBLIC_BUCKET: "画像専用の公開読み取りバケット（任意）。設定するとリンクが storage.googleapis.com を指し、アプリが止まっていても表示できる。",
  IMAGE_BASE_URL: "公開リンクの先頭部分を上書きする（CDN や独自ドメイン）。既定は APP_URL/i、または公開バケットの URL。",
  IMAGE_MAX_DIMENSION: "長辺の上限（16〜8192 px）。拡大はしない。",
  WEBP_QUALITY: "WebP の画質（1〜100）。",
  MAX_UPLOAD_MB: "1 ファイルのアップロード上限（MiB、1〜100。Cloud Run はリクエスト上限が 32 MiB のため 31 まで）。",
  IMAGE_MAX_INPUT_PIXELS: "1 回のアップロードで展開してよい画素数（アニメーションは全フレーム合計、1000000〜1000000000）。画素爆弾からメモリを守る。",
};

const specs: readonly EnvVarSpec[] = ENV_VARS;

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

export function renderEnvExample(): string {
  const required = specs.filter((v) => v.required === true).map((v) => v.name);
  const out = [
    "# Generated from src/server/config.ts ENV_VARS by `pnpm gen:env-docs`. Do not edit by hand.",
    `# Required: ${required.join(", ")}, and at least one of ALLOWED_DOMAINS / ALLOWED_EMAILS.`,
    "# Everything else has a default. Comments sit on their own lines: env-file parsers disagree about",
    "# inline comments. An empty value (FOO=) means the default.",
  ];
  let group: EnvGroup | null = null;
  for (const v of specs) {
    if (v.group !== group) {
      group = v.group;
      out.push("", `# ---------- ${group}`);
    }
    for (const line of wrap(v.doc, 96)) out.push(`# ${line}`);
    if (v.required === true) out.push(`${v.name}=${v.example ?? ""}`);
    else if (v.name === "ALLOWED_DOMAINS") out.push(`${v.name}=`);
    else out.push(`# ${v.name}=${v.default ?? ""}`);
  }
  return `${out.join("\n")}\n`;
}

export function renderEnvTable(locale: "en" | "ja"): string {
  const ja = locale === "ja";
  const header = ja ? ["変数", "既定値", "説明"] : ["Variable", "Default", "Description"];
  const rows = specs.map((v) => {
    const doc = ja ? ENV_DOCS_JA[v.name as EnvName] : v.doc;
    const fallback = v.required === true ? (ja ? "**必須**" : "**required**") : v.required === "gcs" ? (ja ? "gcs のとき必須" : "required for gcs") : "";
    const value = v.default === undefined || v.default === "" ? fallback : `\`${v.default}\``;
    return `| \`${v.name}\` | ${value} | ${doc.replaceAll("|", "\\|")} |`;
  });
  return ["<!-- Generated from ENV_VARS; run `pnpm gen:env-docs`. -->", `| ${header.join(" | ")} |`, "|---|---|---|", ...rows].join("\n");
}

const START = "<!-- env:start -->";
const END = "<!-- env:end -->";

/** Every generated file with its expected content; README files only when they carry the markers. */
export function expectedFiles(read: (path: string) => string | null): { path: string; content: string }[] {
  const files = [{ path: ".env.example", content: renderEnvExample() }];
  for (const [path, locale] of [["README.md", "en"], ["README.ja.md", "ja"]] as const) {
    const current = read(path);
    if (current === null) continue;
    const start = current.indexOf(START);
    const end = current.indexOf(END);
    if (start === -1 || end < start) continue;
    files.push({ path, content: `${current.slice(0, start + START.length)}\n${renderEnvTable(locale)}\n${current.slice(end)}` });
  }
  return files;
}

function main(): void {
  const check = process.argv.includes("--check");
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };
  const stale = expectedFiles(read).filter((f) => read(f.path) !== f.content);
  if (check) {
    for (const f of stale) console.error(`${f.path} is out of date with src/server/config.ts ENV_VARS. Run \`pnpm gen:env-docs\`.`);
    process.exit(stale.length === 0 ? 0 : 1);
  }
  for (const f of stale) {
    writeFileSync(f.path, f.content);
    console.log(`wrote ${f.path}`);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
