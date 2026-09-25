# Workspace Image Hub

[日本語版 README](README.ja.md)

Workspace Image Hub is a self-hosted app for one Google Workspace organization. A member drops an image, pastes one, or picks one from Google Drive. The server converts it to WebP once and returns a public direct link such as `https://img.example.com/i/7k2m9q4xw1hc8d3v.webp`. The link never changes, so it can be the avatar of a Google Chat webhook, an image in a GitHub issue or a Notion page, or the `src` of any `<img>` tag.

It exists because Drive is a poor image host. A Drive sharing link opens an HTML page, not an image. The `uc?export=view` trick breaks whenever Google changes it. Making a Drive folder public to get one avatar URL exposes every other file in that folder. With the app, only the converted WebP is public. The original file, the uploader's address, the file name, and the tags stay private.

Sign-in is Google's "Sign in with Google" button, limited to the Workspace domains and addresses you list. Storage is a local disk or Google Cloud Storage. There is no database. One Docker image serves every organization, and everything is configured through environment variables. The UI is in Japanese and English.

## What it does

- Takes images by drag and drop, the file chooser, paste from the clipboard, or the Google Drive picker. The picker supports multi-select and shared drives. The browser downloads the Drive file and uploads it like a local file, so the server never holds a Drive token.
- Accepts JPEG, PNG, WebP, GIF, AVIF, and TIFF, detected from the bytes rather than the file name. Rejects SVG and HEIC.
- Converts every upload to WebP once. The long edge is capped at `IMAGE_MAX_DIMENSION` (1024 px by default) and never enlarged. Quality is `WEBP_QUALITY` (80 by default). Animated GIF and WebP stay animated. EXIF orientation is applied to still images, and EXIF data is dropped from the output.
- Serves each image at `/i/<id>.webp` with `Cache-Control: public, max-age=31536000, immutable`. The id is 16 characters from 80 random bits, so a link cannot be guessed and the library cannot be enumerated. With a public bucket, the link points at `storage.googleapis.com` and keeps working while the app is down.
- Copies a link as a plain URL or as Markdown, `![file name](url)`.
- Lists every image newest first. Search covers file names, tags, uploaders, and ids, ignores case, and treats katakana and hiragana as the same. Tag filters, tag editing, and the size before and after conversion are on every card. An image takes up to 20 tags of up to 32 characters each.
- Lets in Workspace accounts from `ALLOWED_DOMAINS` and individual accounts from `ALLOWED_EMAILS`. `ADMIN_EMAILS` may delete anything.
- Runs from one Docker image (linux/amd64 and linux/arm64) on a local disk or on Cloud Run with Cloud Storage, with `/healthz`, JSON logs, and a startup check that lists every configuration problem and exits.
- Speaks Japanese and English. `APP_LOCALE` pins one language. Otherwise the user's toggle decides, then the browser's `Accept-Language`.

## Use with Google Chat

A Chat incoming webhook takes its avatar from the **Avatar URL** field in the webhook's settings. Copy the URL from the app and paste it there. The field takes a plain URL, so the app offers no JSON copy format.

## Deploy

There are two ways to run the app. Both use the same Docker image. They differ in where the app runs and where the images are stored.

| | Option 1: Docker Compose | Option 2: Cloud Run |
|---|---|---|
| Runs on | Your own server or PC | Google Cloud |
| Images stored in | A Docker volume on local disk | Cloud Storage buckets |
| Instances | One | Scales with traffic |
| Good for | Trying it out, a small internal server | Running without a server to maintain |

Either way, create an OAuth client id in Google Cloud first.

### Common setup: Google Cloud

Do this once per organization, in a Google Cloud project that belongs to your Workspace organization.

1. Configure the OAuth consent screen. Choose **Internal** when everyone who signs in has an account in your organization. Choose **External** when `ALLOWED_EMAILS` will include accounts outside it.
2. Create an OAuth client id of type **Web application**. Under **Authorized JavaScript origins**, add the exact value you will put in `APP_URL`, with no path. Leave **Authorized redirect URIs** empty. The app renders the Sign in with Google button and verifies the returned ID token on the server, so there is no redirect and no client secret. Put the client id in `GOOGLE_CLIENT_ID`.
3. For Drive import only, enable the Google Picker API and the Google Drive API, then create an API key and restrict it twice. Under application restrictions, allow the website `APP_URL/*`. Under API restrictions, allow only the Google Picker API. Put the key in `GOOGLE_PICKER_API_KEY`. While the key is unset, the Drive button does not appear.

The Picker requires the API key in the page, so every signed-in browser can see it. The referrer restriction is what stops other sites from using it. The Picker also needs your Cloud project number. A client id normally begins with that number (`123456789012-...`), and the app reads it from there. If your client id does not start with digits, set `GOOGLE_PROJECT_NUMBER`. The first Drive import asks the user to grant the `drive.file` scope, which covers only the files that user picks.

### Option 1: Docker Compose (local disk)

You need Docker with the Compose plugin and an OAuth client id from [Common setup](#common-setup-google-cloud). For this quick start, register `http://localhost:3000` as the client's authorized JavaScript origin.

```sh
mkdir image-hub && cd image-hub
curl -fsSLO https://raw.githubusercontent.com/shngmsw/workspace-image-hub/main/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/shngmsw/workspace-image-hub/main/.env.example
```

Open `.env` and fill in the four required values. Generate `AUTH_SECRET` with `openssl rand -base64 32`. Everything else has a default.

```dotenv
APP_URL=http://localhost:3000
AUTH_SECRET=<openssl rand -base64 32>
GOOGLE_CLIENT_ID=123456789012-abc123.apps.googleusercontent.com
ALLOWED_DOMAINS=example.com
```

```sh
docker compose up -d
```

Open http://localhost:3000 and sign in with a Google account on `example.com`. Images and records live in the Docker named volume `hub-data`, mounted at `/data` inside the container. `i/` holds the images and `r/` holds the records (uploader, original file name, tags). Copy that volume and you have a backup.

Docker manages where the volume lives on the host. Compose prefixes the volume name with the project name, which defaults to the folder name, so with the steps above the volume is `image-hub_hub-data` and `docker volume inspect image-hub_hub-data` shows its `Mountpoint`. `docker compose down` keeps the volume. Only `docker compose down -v` deletes it.

On a Linux host, to keep the data in a host folder instead of a volume, change `hub-data:/data` in `compose.yaml` to `./data:/data`. The container runs as uid 1000, so that folder must be writable by uid 1000.

To run behind a TLS reverse proxy, set `APP_URL` to the https origin, for example `https://img.example.com`, and add that origin to the OAuth client. Nothing else changes. Over plain http, the session cookie is sent without the `Secure` flag, and the log says so at startup.

If a value is wrong, the container exits with code 78 and the log lists every problem at once. `docker compose logs hub` shows it. `docker compose pull && docker compose up -d` updates the app. The local driver assumes one process, so keep it at one container.

`compose.yaml` pulls `ghcr.io/shngmsw/workspace-image-hub:latest`. A release tag such as `v1.2.3` publishes `latest`, `1.2.3`, `1.2`, and `1`. Every push to `main` publishes `edge`.

### Option 2: Cloud Run with Cloud Storage

Cloud Run's disk is ephemeral, so the app refuses `STORAGE_DRIVER=local` there. Use two buckets.

- `GCS_BUCKET` is private, with public access prevention enforced. It holds one record per image, and the images too when there is no public bucket. A record is a zero-byte object under `r/` whose data sits in the custom metadata key `wih-record`.
- `GCS_PUBLIC_BUCKET` is optional and holds images only, under `i/`. `allUsers` gets a custom role with the single permission `storage.objects.get`. Links then point at `https://storage.googleapis.com/<bucket>/i/<id>.webp`, are served by Cloud Storage, and keep working through cold starts and outages. `APP_URL/i/<id>.webp` still serves the same bytes.

Records never go in the public bucket. Cloud Storage returns custom metadata to anonymous readers as `x-goog-meta-*` headers, and a record holds the uploader's email, the original file name, and the tags. The app refuses to start when the two bucket names are equal. The role is custom rather than `roles/storage.objectViewer` because `objectViewer` includes `storage.objects.list`, which would let anyone enumerate every image id. With get only, a link is known only to the people you gave it to.

The commands below assume `gcloud` is signed in and use the Tokyo region. Replace `my-project`, `example.com`, and the client id with your own.

```sh
PROJECT_ID=my-project REGION=asia-northeast1 SERVICE=image-hub
gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
# Cloud Run's deterministic URL. Add it to the OAuth client's JavaScript origins before the first sign-in.
APP_URL="https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# Private bucket for records. Public bucket for images: readable by name, not listable.
gcloud storage buckets create "gs://$PROJECT_ID-hub" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets create "gs://$PROJECT_ID-hub-public" --location="$REGION" \
  --uniform-bucket-level-access
gcloud iam roles create hubObjectGet --project="$PROJECT_ID" \
  --title="Get objects by name" --permissions=storage.objects.get
gcloud storage buckets add-iam-policy-binding "gs://$PROJECT_ID-hub-public" \
  --member=allUsers --role="projects/$PROJECT_ID/roles/hubObjectGet"

# The service account reads and writes both buckets and reads the session secret.
gcloud iam service-accounts create image-hub
SA="image-hub@$PROJECT_ID.iam.gserviceaccount.com"
for b in hub hub-public; do
  gcloud storage buckets add-iam-policy-binding "gs://$PROJECT_ID-$b" \
    --member="serviceAccount:$SA" --role=roles/storage.objectUser
done
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create hub-auth-secret --data-file=-
gcloud secrets add-iam-policy-binding hub-auth-secret \
  --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor

# Build the repository's Dockerfile with Cloud Build and deploy it.
git clone https://github.com/shngmsw/workspace-image-hub.git && cd workspace-image-hub
gcloud run deploy "$SERVICE" --source . --region="$REGION" --service-account="$SA" \
  --allow-unauthenticated --memory=2Gi --concurrency=10 \
  --set-env-vars="APP_URL=$APP_URL,STORAGE_DRIVER=gcs,GCS_BUCKET=$PROJECT_ID-hub,GCS_PUBLIC_BUCKET=$PROJECT_ID-hub-public,GOOGLE_CLIENT_ID=123456789012-abc123.apps.googleusercontent.com,ALLOWED_DOMAINS=example.com" \
  --set-secrets="AUTH_SECRET=hub-auth-secret:latest"
```

Some things to know about this deployment:

- For Drive import, enable the two APIs, add `GOOGLE_PICKER_API_KEY=...` to `--set-env-vars`, and put the Cloud Run origin in the key's website restriction.
- A value that contains a comma, such as `ALLOWED_DOMAINS=example.com,example.co.jp`, needs gcloud's alternate delimiter. Start the flag value with `^|^` and separate the variables with `|`.
- Cloud Run sets `PORT=8080`, and the app listens on it. `MAX_UPLOAD_MB` is capped at 31 there because a Cloud Run request is at most 32 MiB.
- `--memory=2Gi --concurrency=10` bounds memory. Each request buffers its upload in memory, up to `MAX_UPLOAD_MB`, and each instance runs at most two conversions at a time.
- At startup the app lists one object in each bucket. A wrong bucket name or a missing role fails the deploy's health check instead of the first upload.
- Cloud Run does not pull from ghcr.io. To run the prebuilt image instead of building from source, copy it into Artifact Registry and deploy with `--image`.

Many Workspace organizations enforce the org policies **Domain restricted sharing** (`iam.allowedPolicyMemberDomains`) or **Enforce public access prevention** (`storage.publicAccessPrevention`). Both reject `allUsers`. In that case, create only the private bucket, leave `GCS_PUBLIC_BUCKET` unset, and skip the `hubObjectGet` role and its binding. The app then serves images itself from the private bucket, and links point at `APP_URL/i/<id>.webp`. They are still immutable and cacheable. The cost is that every uncached image request is a Cloud Run request, and images are unreachable while the service is down. Domain restricted sharing also rejects the `roles/run.invoker` binding for `allUsers` that `--allow-unauthenticated` creates. In that case deploy with `--no-invoker-iam-check` instead. That flag makes Cloud Run accept callers without an IAM check.

## Environment variables

`ENV_VARS` in `src/server/config.ts` is the single source. `pnpm gen:env-docs` writes `.env.example` and the table below from it, and CI fails when they drift. `APP_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and at least one of `ALLOWED_DOMAINS` or `ALLOWED_EMAILS` are required. An empty value means the default.

<!-- env:start -->
<!-- Generated from ENV_VARS; run `pnpm gen:env-docs`. -->
| Variable | Default | Description |
|---|---|---|
| `APP_URL` | **required** | Public origin of the app, e.g. https://img.example.com. No path. Add it to the OAuth client's Authorized JavaScript origins. |
| `APP_NAME` | `Image Hub` | Product name shown in the UI and page title. |
| `APP_LOCALE` | `auto` | auto \| ja \| en. auto = the user's language toggle, then Accept-Language. |
| `PORT` | `3000` | Listen port. Cloud Run injects 8080. |
| `AUTH_SECRET` | **required** | At least 32 characters. Signs session cookies. Generate with `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` | **required** | OAuth 2.0 Web client id (<project-number>-<hash>.apps.googleusercontent.com). Used by the Sign in with Google button and the Drive picker. |
| `ALLOWED_DOMAINS` |  | Comma list of Google Workspace domains, e.g. example.com,example.co.jp. A managed account (ID token has `hd`) passes when `hd` or its email domain is listed, exactly. Consumer accounts never pass a domain rule. |
| `ALLOWED_EMAILS` |  | Comma list of individual addresses (any Google account). At least one of ALLOWED_DOMAINS / ALLOWED_EMAILS must be set. |
| `ADMIN_EMAILS` |  | Comma list of members who may delete any image. Everyone else may delete only their own. |
| `SESSION_TTL_HOURS` | `12` | Session lifetime in hours (1..720). A member removed in Google Workspace keeps access at most this long; removing them from the allow-list cuts access on the next request. |
| `GOOGLE_PICKER_API_KEY` |  | Browser API key restricted to the Picker API and the APP_URL referrer. Unset = the Drive button is hidden. |
| `GOOGLE_PROJECT_NUMBER` |  | Cloud project number for the Picker. Derived from GOOGLE_CLIENT_ID when unset. |
| `STORAGE_DRIVER` | `local` | local \| gcs. local is refused on Cloud Run, whose disk is ephemeral. |
| `DATA_DIR` | `./data` | local driver root. Must support hard links. The Docker image sets /data (a volume). |
| `GCS_BUCKET` | required for gcs | Private bucket for records, and for images unless GCS_PUBLIC_BUCKET is set. |
| `GCS_PUBLIC_BUCKET` |  | Optional public-read bucket for images only. Links then point at storage.googleapis.com and keep working while the app is down. |
| `IMAGE_BASE_URL` |  | Override the base of public links (CDN or custom domain). Default: APP_URL/i, or the public bucket URL. |
| `IMAGE_MAX_DIMENSION` | `1024` | Long-edge cap in px (16..8192). Images are never upscaled. |
| `WEBP_QUALITY` | `80` | WebP quality (1..100). |
| `MAX_UPLOAD_MB` | `20` | Per-file upload cap in MiB (1..100; at most 31 on Cloud Run, whose request limit is 32 MiB). |
| `IMAGE_MAX_INPUT_PIXELS` | `100000000` | Decoded pixels allowed per upload, all animation frames counted (1000000..1000000000). Guards memory against pixel bombs. |
<!-- env:end -->

Startup checks the whole set, reports every problem at once, and exits with code 78. Among the refusals: an `AUTH_SECRET` shorter than 32 characters, an `APP_URL` with a path, an empty allow-list, `STORAGE_DRIVER=local` on Cloud Run, a `GCS_PUBLIC_BUCKET` equal to `GCS_BUCKET`, and a `MAX_UPLOAD_MB` above 31 on Cloud Run. An `ADMIN_EMAILS` entry that no allow-list covers is only a warning, but that admin cannot sign in.

## Security model

**Sign-in.** The page renders the Sign in with Google button with a nonce that the server also stored in an HttpOnly cookie, valid for 15 minutes. The button returns a Google ID token, and the browser posts it to `POST /auth/google`. The server verifies the token's signature and audience (`GOOGLE_CLIENT_ID`) with `google-auth-library`, checks that the token's nonce matches the cookie, and only then reads the claims. There is no client secret and no redirect URI, and the server never stores a Google token.

**Who gets in.** `decideAccess` in `src/server/auth.ts` is the whole rule, and it runs on verified claims only. `email_verified` must be true. An address in `ALLOWED_EMAILS` passes, whatever kind of Google account it is. A domain rule needs the `hd` claim. Google sets `hd` only on Workspace and Cloud Identity managed accounts, and the account passes when `hd` or the email's domain is listed in `ALLOWED_DOMAINS`. Matching is exact. `evil-example.com` and `example.com.evil` never match `example.com`. A consumer Google account registered as `alice@example.com` has no `hd` and never passes a domain rule. The `hd` hint on the button only narrows Google's account chooser. The server decides.

**Sessions.** The session is a signed cookie (HS256, key derived from `AUTH_SECRET`). It is `HttpOnly` and `SameSite=Lax` always, and `Secure` with the `__Host-` prefix on https. It lasts `SESSION_TTL_HOURS`, 12 by default, and there is no session store. The allow-list is evaluated again on every request, so removing an address or domain from the configuration and restarting cuts that person off at their next request. A member suspended in Workspace keeps access until the session expires. Changing `AUTH_SECRET` signs everyone out.

**Requests.** Every request other than GET and HEAD must carry an `Origin` header equal to `APP_URL`, including the sign-in POST. Upload metadata travels in the `X-Upload-Meta` header, not the query string, so file names and tags stay out of proxy and Cloud Run request logs. The page ships a Content-Security-Policy that allows scripts only from the app itself and from Google's sign-in and Picker origins.

**Delete.** Only the uploader or an address in `ADMIN_EMAILS` may delete an image. Anyone else gets 403. Any member may edit any image's tags. A delete removes the image first and the record second, and the link then returns 404. What a delete cannot do is recall copies. Every link is served with `Cache-Control: public, max-age=31536000, immutable`, so browsers, Google Chat, the GitHub and Notion image proxies, a CDN, and Cloud Storage's own caches may keep showing the image for a while. The confirmation dialog says so. Treat a link as public for a year from the moment you paste it anywhere.

**Public bytes, private facts.** An image object carries no custom metadata and no EXIF. The uploader, the file name, and the tags live only in the record, in the private bucket or in `DATA_DIR/r/`. Ids come from 80 random bits, never from the clock, and the public bucket role cannot list, so nobody can enumerate the library from outside.

**Image bytes.** The format is detected from the bytes, never from the file name or Content-Type. SVG is rejected because it can carry scripts. HEIC is rejected because the bundled libvips has no HEVC decoder. Uploads stop at `MAX_UPLOAD_MB`. Decoding is refused before it starts when the pixel count across all frames exceeds `IMAGE_MAX_INPUT_PIXELS`, so a small file that would decode to gigabytes is rejected first.

**What the browser knows.** The server embeds a `BootConfig` JSON in the page: the app name, the locale, the upload limits, the OAuth client id, and, when Drive import is on, the Picker API key and project number. The client bundle contains no configuration, and no secret ever reaches it. The Picker key is a browser key by design, and the referrer restriction is its protection.

## Develop

You need Node 24 and pnpm. `corepack enable` gives you the pnpm version pinned in `package.json`.

```sh
git clone https://github.com/shngmsw/workspace-image-hub.git && cd workspace-image-hub
pnpm install
DEV_FAKE_LOGIN=alice@example.com pnpm dev
```

On PowerShell, set the variable first: `$env:DEV_FAKE_LOGIN = "alice@example.com"; pnpm dev`.

`pnpm dev` runs Vite with the Hono server in the same process at http://localhost:5173 and stores images in `./data`. With `DEV_FAKE_LOGIN=<address>` there is no Google sign-in. Every request runs as that address, `AUTH_SECRET` and `GOOGLE_CLIENT_ID` get placeholder values, and the address is allow-listed when you set no list. Send the header `X-Dev-User: bob@example.com` to act as someone else. `ADMIN_EMAILS` still decides who is an admin.

To use the real sign-in button in development, leave `DEV_FAKE_LOGIN` unset, export `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `ALLOWED_DOMAINS` in the shell, and add `http://localhost:5173` to the OAuth client's JavaScript origins. The dev server reads the shell environment. It does not read `.env`.

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server with the API in-process, on port 5173. |
| `pnpm build` | Builds the client to `dist/client` and the server bundle to `dist/server/main.js`. |
| `pnpm start` | Runs the built server with the shell environment. Port 3000 by default. |
| `pnpm test` | Runs the unit tests with Vitest. With `GCS_TEST_BUCKET=<bucket>` set, the store contract also runs against that bucket with your Application Default Credentials. |
| `pnpm lint`, `pnpm typecheck` | ESLint and `tsc --noEmit`. |
| `pnpm gen:env-docs` | Regenerates `.env.example` and the env tables in both READMEs from `ENV_VARS`. `--check` only compares. |
| `pnpm smoke` | End-to-end check against a running dev server. |

The smoke test needs a dev server started with `DEV_FAKE_LOGIN`, plus `curl`, `node`, and a POSIX `sh`. Git Bash works on Windows. Run `pnpm smoke` in a second terminal. It generates a 3000×2000 PNG with sharp, uploads it, and checks that the result is 1024 px wide and smaller than the input. It fetches the link with GET and HEAD and checks the status, `Content-Type`, `Content-Length`, and `Cache-Control`. It lists the library, patches tags, tries a delete as `bob@example.com` and expects 403, deletes twice as the owner and expects 204 both times, and prints what the link returns afterwards. `BASE=<url>` points it at another server. `KEEP=1` leaves the image in place.

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, build, and `pnpm gen:env-docs --check` on pushes to `main` and on pull requests. `.github/workflows/docker.yml` builds the image for linux/amd64 and linux/arm64 and pushes it to GHCR on pushes to `main` and on `v*` tags. The HTTP routes are listed in `ROUTES` in `src/shared/api.ts`.

## License

MIT. See [LICENSE](LICENSE).

Google Workspace, Google Drive, and Google Chat are trademarks of Google LLC. This project is not affiliated with or endorsed by Google.
