# Workspace Image Hub

[English README](README.md)

Workspace Image Hub は、Google Workspace を使う組織向けのセルフホスト型の画像置き場です。メンバーが画像をドロップするか、貼り付けるか、Google ドライブから選ぶと、サーバーが一度だけ WebP に変換して `https://img.example.com/i/7k2m9q4xw1hc8d3v.webp` のような公開直リンクを返します。リンクは変わらないので、Google Chat の Webhook のアバター、GitHub の Issue、Notion のページ、社内ポータルの `<img>` タグにそのまま貼れます。

作った理由は、ドライブが画像の配信に向いていないからです。共有リンクを開くと HTML のページが出てきて、画像そのものは返ってきません。`uc?export=view` の裏技は Google 側の変更でたびたび壊れます。アバター 1 枚のためにドライブのフォルダごと公開設定にすると、同じフォルダの他のファイルまで見えてしまいます。このアプリで公開されるのは変換後の WebP だけで、元のファイル、登録した人のアドレス、ファイル名、タグは外に出ません。

ログインは Google の「Google でログイン」ボタンで、許可したドメインとアドレスのアカウントしか通しません。保存先はローカルディスクか Google Cloud Storage で、データベースは使いません。Docker イメージは 1 つで、設定はすべて環境変数です。画面は日本語と英語に対応しています。

## できること

- 画像の取り込み方は、ドラッグ＆ドロップ、ファイル選択、クリップボードからの貼り付け、Google ドライブのピッカーの 4 通りです。ピッカーは複数選択と共有ドライブに対応しています。ドライブのファイルはブラウザがダウンロードしてローカルファイルと同じ経路でアップロードするので、サーバーはドライブのトークンを一切受け取りません。
- 受け付ける形式は JPEG、PNG、WebP、GIF、AVIF、TIFF です。判定はファイル名や Content-Type ではなく中身のバイト列で行います。SVG と HEIC は受け付けません。
- 変換は WebP への 1 回きりです。長辺は `IMAGE_MAX_DIMENSION`（既定 1024px）に収め、拡大はしません。画質は `WEBP_QUALITY`（既定 80）です。アニメーション GIF とアニメーション WebP はアニメーションのまま変換します。静止画は EXIF の向き情報を反映したうえで、EXIF そのものは出力に残しません。
- 配信 URL は `/i/<id>.webp` で、`Cache-Control: public, max-age=31536000, immutable` を付けて返します。ID は 80 ビットの乱数から作る 16 文字なので、推測はできず、一覧を取る手段もありません。公開バケットを使う構成では、リンクは `storage.googleapis.com` を指し、アプリが止まっていても表示され続けます。
- コピーは URL そのままか、Markdown の `![ファイル名](URL)` の 2 種類です。
- ライブラリでは全画像を新しい順に並べ、ファイル名、タグ、登録者、ID で検索できます。大文字と小文字、カタカナとひらがなの違いは無視します。タグでの絞り込み、タグの編集、変換前後のサイズ表示もあります。タグは 1 枚につき 20 個まで、1 つ 32 文字までです。
- ログインできるのは `ALLOWED_DOMAINS` のドメインの Workspace アカウントと、`ALLOWED_EMAILS` に列挙した個別のアカウントです。`ADMIN_EMAILS` に入れた人は誰の画像でも削除できます。
- Docker イメージ 1 つ（linux/amd64 と linux/arm64）で、ローカルディスクでも、Cloud Run と Cloud Storage の組み合わせでも動きます。`/healthz`、JSON 形式のログ、起動時の設定チェック（問題を全部並べて終了する）が付いています。
- 画面は日本語と英語で、`APP_LOCALE` で固定できます。未設定なら利用者の切り替え、次にブラウザの言語で決めます。

## Google Chat で使うとき

Google Chat の着信 Webhook のアバターは、Webhook の設定にあるアバター URL の欄で決まります。ここに、アプリでコピーした URL をそのまま貼り付けてください。この欄は URL しか受け取らないので、JSON 形式のコピーは用意していません。

## 動かし方

動かし方は 2 通りあります。どちらも同じ Docker イメージを使い、違うのは置き場所と画像の保存先です。

| | 方法 1: Docker Compose | 方法 2: Cloud Run |
|---|---|---|
| 置き場所 | 自分のサーバーや PC | Google Cloud |
| 画像の保存先 | Docker ボリューム（ローカルディスク） | Cloud Storage のバケット |
| 台数 | 1 台 | アクセスに応じて自動で増減 |
| 向いている場面 | まず試す、社内サーバーで小さく使う | サーバーを持たずに運用する |

どちらの方法でも、先に Google Cloud で OAuth クライアント ID を作ります。

### 共通の準備: Google Cloud

組織ごとに 1 回だけ行います。プロジェクトは Workspace の組織に属するものを使ってください。

1. OAuth 同意画面を設定します。ログインする人が全員この組織のアカウントなら「内部」を選びます。`ALLOWED_EMAILS` に組織外のアカウントを入れる予定があるなら「外部」にします。
2. OAuth クライアント ID を、アプリケーションの種類「ウェブ アプリケーション」で作ります。承認済みの JavaScript 生成元に、`APP_URL` に設定する値をパスなしでそのまま登録します。承認済みのリダイレクト URI は空のままで構いません。このアプリは「Google でログイン」ボタンが返す ID トークンをサーバーで検証する方式なので、リダイレクトもクライアント シークレットも使いません。できたクライアント ID を `GOOGLE_CLIENT_ID` に入れます。
3. ドライブから取り込みたい場合だけ、Google Picker API と Google Drive API を有効にして、API キーを作ります。キーには制限を 2 つかけてください。アプリケーションの制限はウェブサイトで `APP_URL/*`、API の制限は Google Picker API だけです。このキーを `GOOGLE_PICKER_API_KEY` に入れます。未設定の間はドライブのボタンが表示されません。

API キーはピッカーの仕様上ページに埋め込むものなので、ログインした人には見えます。よそのサイトから使われないように守っているのはリファラー制限です。ピッカーには Cloud プロジェクト番号も必要ですが、普通はクライアント ID の先頭（`123456789012-...` の数字の部分）から取れます。数字で始まらないクライアント ID のときだけ `GOOGLE_PROJECT_NUMBER` を設定してください。初めてドライブから取り込むとき、利用者には `drive.file` スコープの同意画面が出ます。このスコープで触れるのは、その人がピッカーで選んだファイルだけです。

### 方法 1: Docker Compose（ローカルディスクに保存）

必要なのは Compose プラグイン入りの Docker と、上の [共通の準備](#共通の準備-google-cloud) で作る OAuth クライアント ID です。まず試すだけなら、OAuth クライアントの承認済みの JavaScript 生成元に `http://localhost:3000` を登録しておきます。

```sh
mkdir image-hub && cd image-hub
curl -fsSLO https://raw.githubusercontent.com/shngmsw/workspace-image-hub/main/compose.yaml
curl -fsSL -o .env https://raw.githubusercontent.com/shngmsw/workspace-image-hub/main/.env.example
```

`.env` を開いて、必須の 4 つを埋めます。`AUTH_SECRET` は `openssl rand -base64 32` の出力を貼ります。残りは既定値のままで動きます。

```dotenv
APP_URL=http://localhost:3000
AUTH_SECRET=<openssl rand -base64 32>
GOOGLE_CLIENT_ID=123456789012-abc123.apps.googleusercontent.com
ALLOWED_DOMAINS=example.com
```

```sh
docker compose up -d
```

http://localhost:3000 を開いて、`example.com` の Google アカウントでログインします。保存先は Docker の名前付きボリューム `hub-data` です。コンテナの中では `/data` に見え、`i/` に画像、`r/` に記録（登録した人、元のファイル名、タグ）が入ります。このボリュームを丸ごとコピーすればバックアップになります。

ホスト側の実際の場所は Docker が管理しています。Compose はボリューム名の頭にプロジェクト名（既定はフォルダ名）を付けるので、上の手順どおり `image-hub` フォルダで動かした場合は `docker volume inspect image-hub_hub-data` の `Mountpoint` で場所が分かります。ボリュームは `docker compose down` では消えず、`docker compose down -v` を実行したときだけ消えます。

Linux のホストで、ボリュームではなくホストのフォルダに直接置きたい場合は、`compose.yaml` の `hub-data:/data` を `./data:/data` に書き換えます。コンテナは uid 1000 で動くので、そのフォルダに uid 1000 が書き込めるようにしておいてください。

TLS を終端するリバースプロキシの後ろに置くときは、`APP_URL` を `https://img.example.com` のような https のオリジンにして、そのオリジンを OAuth クライアントにも登録します。変えるのはそれだけです。http のままだとセッション Cookie に `Secure` が付かず、起動時のログに警告が出ます。

設定に誤りがあると、コンテナは終了コード 78 で止まり、ログに問題を全部並べます。`docker compose logs hub` で確認してください。更新は `docker compose pull && docker compose up -d` です。local ドライバはプロセス 1 つが前提なので、コンテナを 2 つ以上並べないでください。

`compose.yaml` が参照するイメージは `ghcr.io/shngmsw/workspace-image-hub:latest` です。`v1.2.3` のようなタグを打つと `latest`、`1.2.3`、`1.2`、`1` が公開され、`main` への push ごとに `edge` が更新されます。

### 方法 2: Cloud Run と Cloud Storage

Cloud Run のディスクは消えるので、`STORAGE_DRIVER=local` はそこでは起動を拒否します。バケットを 2 つ使います。

- `GCS_BUCKET` は非公開で、公開アクセスの防止を有効にしておきます。画像 1 枚につき 1 つの記録を置き、公開バケットがなければ画像もここに入ります。記録は `r/` 配下のサイズ 0 のオブジェクトで、中身はカスタム メタデータのキー `wih-record` に入っています。
- `GCS_PUBLIC_BUCKET` は任意で、`i/` 配下に画像だけを置きます。`allUsers` には `storage.objects.get` だけを持つカスタムロールを付けます。リンクは `https://storage.googleapis.com/<バケット>/i/<id>.webp` になり、Cloud Storage が直接配信するので、コールドスタート中やアプリの停止中でも表示されます。`APP_URL/i/<id>.webp` でも同じ画像が返ります。

記録を公開バケットに置かない理由は、Cloud Storage が匿名の読み手にもカスタム メタデータを `x-goog-meta-*` ヘッダーで返すからです。記録には登録した人のメールアドレス、元のファイル名、タグが入っています。2 つのバケット名が同じだと、アプリは起動しません。ロールを `roles/storage.objectViewer` にしないのは、そこに `storage.objects.list` が含まれていて、誰でも全画像の ID を列挙できてしまうからです。get だけなら、リンクを知っているのは自分が渡した相手だけです。

以下は `gcloud` にログイン済みで、リージョンに東京（`asia-northeast1`）を使う前提です。`my-project`、`example.com`、クライアント ID は自分のものに置き換えてください。

```sh
PROJECT_ID=my-project REGION=asia-northeast1 SERVICE=image-hub
gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
# Cloud Run の決定論的 URL。最初のログインより前に OAuth クライアントの JavaScript 生成元へ登録しておく
APP_URL="https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# 記録用の非公開バケットと、画像用の公開バケット（名前で取れるが一覧はできない）
gcloud storage buckets create "gs://$PROJECT_ID-hub" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets create "gs://$PROJECT_ID-hub-public" --location="$REGION" \
  --uniform-bucket-level-access
gcloud iam roles create hubObjectGet --project="$PROJECT_ID" \
  --title="Get objects by name" --permissions=storage.objects.get
gcloud storage buckets add-iam-policy-binding "gs://$PROJECT_ID-hub-public" \
  --member=allUsers --role="projects/$PROJECT_ID/roles/hubObjectGet"

# サービスアカウント。両方のバケットを読み書きし、セッション用シークレットを読む
gcloud iam service-accounts create image-hub
SA="image-hub@$PROJECT_ID.iam.gserviceaccount.com"
for b in hub hub-public; do
  gcloud storage buckets add-iam-policy-binding "gs://$PROJECT_ID-$b" \
    --member="serviceAccount:$SA" --role=roles/storage.objectUser
done
openssl rand -base64 32 | tr -d '\n' | gcloud secrets create hub-auth-secret --data-file=-
gcloud secrets add-iam-policy-binding hub-auth-secret \
  --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor

# リポジトリの Dockerfile を Cloud Build でビルドしてデプロイ
git clone https://github.com/shngmsw/workspace-image-hub.git && cd workspace-image-hub
gcloud run deploy "$SERVICE" --source . --region="$REGION" --service-account="$SA" \
  --allow-unauthenticated --memory=2Gi --concurrency=10 \
  --set-env-vars="APP_URL=$APP_URL,STORAGE_DRIVER=gcs,GCS_BUCKET=$PROJECT_ID-hub,GCS_PUBLIC_BUCKET=$PROJECT_ID-hub-public,GOOGLE_CLIENT_ID=123456789012-abc123.apps.googleusercontent.com,ALLOWED_DOMAINS=example.com" \
  --set-secrets="AUTH_SECRET=hub-auth-secret:latest"
```

この構成で知っておくこと。

- ドライブからの取り込みを使うなら、2 つの API を有効にしたうえで `--set-env-vars` に `GOOGLE_PICKER_API_KEY=...` を足し、API キーのウェブサイト制限に Cloud Run のオリジンを入れます。
- `ALLOWED_DOMAINS=example.com,example.co.jp` のように値にカンマを含めるときは、gcloud の区切り文字指定を使います。フラグの値を `^|^` で始め、変数同士を `|` で区切ります。
- `PORT` は Cloud Run が 8080 を渡すので設定不要です。`MAX_UPLOAD_MB` は 31 までです。Cloud Run のリクエスト上限が 32 MiB だからです。
- `--memory=2Gi --concurrency=10` はメモリの上限を押さえるための値です。リクエストごとにアップロードを最大 `MAX_UPLOAD_MB` までメモリに載せ、変換はインスタンスあたり同時 2 本までなので、この組み合わせで収まります。
- 起動時に各バケットでオブジェクトを 1 件だけ一覧して、つながることを確かめます。バケット名の打ち間違いやロールの付け忘れは、最初のアップロードではなくデプロイ時のヘルスチェックで分かります。
- Cloud Run は ghcr.io から直接 pull できません。ソースからビルドせずに公開済みのイメージを使いたいときは、Artifact Registry にコピーしてから `--image` でデプロイしてください。

Workspace の組織には、組織ポリシーのドメインで制限された共有（`iam.allowedPolicyMemberDomains`）や公開アクセスの防止の適用（`storage.publicAccessPrevention`）を有効にしているところが少なくありません。どちらも `allUsers` への付与を拒否します。その場合は公開バケットを作らず、`GCS_PUBLIC_BUCKET` を空のままにして、`hubObjectGet` ロールとその付与も省きます。画像はアプリが非公開バケットから読んで配信し、リンクは `APP_URL/i/<id>.webp` になります。リンクが immutable でキャッシュされる点は同じです。代わりに、キャッシュにない画像へのアクセスは 1 件ずつ Cloud Run のリクエストになり、サービスが止まっている間は画像も見えません。ドメインで制限された共有は、`--allow-unauthenticated` が `allUsers` に付ける `roles/run.invoker` も拒否します。そのときは代わりに `--no-invoker-iam-check` を付けてデプロイします。このフラグを付けると、Cloud Run は呼び出し元の IAM チェックをしなくなります。

## 環境変数

`src/server/config.ts` の `ENV_VARS` が唯一の定義元です。`pnpm gen:env-docs` がそこから `.env.example` と下の表を生成し、ずれていると CI が落ちます。必須は `APP_URL`、`AUTH_SECRET`、`GOOGLE_CLIENT_ID` と、`ALLOWED_DOMAINS` か `ALLOWED_EMAILS` の少なくとも一方です。空の値は既定値と同じ扱いです。

<!-- env:start -->
<!-- Generated from ENV_VARS; run `pnpm gen:env-docs`. -->
| 変数 | 既定値 | 説明 |
|---|---|---|
| `APP_URL` | **必須** | アプリの公開オリジン（例: https://img.example.com）。パスは付けない。OAuth クライアントの「承認済みの JavaScript 生成元」にも登録する。 |
| `APP_NAME` | `Image Hub` | 画面とページタイトルに表示する名前。 |
| `APP_LOCALE` | `auto` | auto \| ja \| en。auto は利用者の言語切り替え、次に Accept-Language で決める。 |
| `PORT` | `3000` | 待ち受けポート。Cloud Run は 8080 を渡す。 |
| `AUTH_SECRET` | **必須** | 32 文字以上。セッション Cookie の署名に使う。`openssl rand -base64 32` で生成する。 |
| `GOOGLE_CLIENT_ID` | **必須** | OAuth 2.0 ウェブクライアント ID（<プロジェクト番号>-<ハッシュ>.apps.googleusercontent.com）。「Google でログイン」ボタンと Drive ピッカーが使う。 |
| `ALLOWED_DOMAINS` |  | Google Workspace のドメインをカンマ区切りで指定（例: example.com,example.co.jp）。管理対象アカウント（ID トークンに hd がある）で、hd かメールのドメインが完全一致すれば通す。個人の Google アカウントはドメイン指定では通らない。 |
| `ALLOWED_EMAILS` |  | 個別に許可するアドレスをカンマ区切りで指定（どの Google アカウントでも可）。ALLOWED_DOMAINS と ALLOWED_EMAILS の少なくとも一方が必要。 |
| `ADMIN_EMAILS` |  | すべての画像を削除できるメンバーをカンマ区切りで指定。それ以外の人は自分の画像だけ削除できる。 |
| `SESSION_TTL_HOURS` | `12` | セッションの有効時間（1〜720 時間）。Workspace で停止された人もこの時間までは使える。許可リストから外せば次のリクエストで締め出される。 |
| `GOOGLE_PICKER_API_KEY` |  | Picker API と APP_URL のリファラーに制限したブラウザ用 API キー。未設定なら Drive ボタンを出さない。 |
| `GOOGLE_PROJECT_NUMBER` |  | Picker 用の Cloud プロジェクト番号。未設定なら GOOGLE_CLIENT_ID から求める。 |
| `STORAGE_DRIVER` | `local` | local \| gcs。local は Cloud Run では使えない（ディスクが消えるため）。 |
| `DATA_DIR` | `./data` | local ドライバの保存先。ハードリンクが使えるファイルシステムが必要。Docker イメージは /data（ボリューム）を指定済み。 |
| `GCS_BUCKET` | gcs のとき必須 | 記録（メタデータ）用の非公開バケット。GCS_PUBLIC_BUCKET が無ければ画像もここに置く。 |
| `GCS_PUBLIC_BUCKET` |  | 画像専用の公開読み取りバケット（任意）。設定するとリンクが storage.googleapis.com を指し、アプリが止まっていても表示できる。 |
| `IMAGE_BASE_URL` |  | 公開リンクの先頭部分を上書きする（CDN や独自ドメイン）。既定は APP_URL/i、または公開バケットの URL。 |
| `IMAGE_MAX_DIMENSION` | `1024` | 長辺の上限（16〜8192 px）。拡大はしない。 |
| `WEBP_QUALITY` | `80` | WebP の画質（1〜100）。 |
| `MAX_UPLOAD_MB` | `20` | 1 ファイルのアップロード上限（MiB、1〜100。Cloud Run はリクエスト上限が 32 MiB のため 31 まで）。 |
| `IMAGE_MAX_INPUT_PIXELS` | `100000000` | 1 回のアップロードで展開してよい画素数（アニメーションは全フレーム合計、1000000〜1000000000）。画素爆弾からメモリを守る。 |
<!-- env:end -->

起動時に全項目を検査し、問題を全部まとめて出してから終了コード 78 で止まります。たとえば 32 文字未満の `AUTH_SECRET`、パス付きの `APP_URL`、空の許可リスト、Cloud Run 上の `STORAGE_DRIVER=local`、`GCS_BUCKET` と同じ `GCS_PUBLIC_BUCKET`、Cloud Run 上で 31 を超える `MAX_UPLOAD_MB` は起動を拒否します。`ADMIN_EMAILS` に入れたのに許可リストに含まれないアドレスは警告だけで済みますが、その人はログインできません。

## セキュリティの仕組み

### ログイン

ページには「Google でログイン」ボタンを、サーバーが HttpOnly Cookie にも入れた nonce 付きで描画します。nonce の有効期間は 15 分です。ボタンが返す Google の ID トークンをブラウザが `POST /auth/google` に送り、サーバーが `google-auth-library` で署名と audience（`GOOGLE_CLIENT_ID`）を検証し、トークンの nonce が Cookie と一致することを確かめてから、初めてクレームを見ます。クライアント シークレットもリダイレクト URI もなく、Google のトークンをサーバーに保存することもありません。

### 誰が入れるか

`src/server/auth.ts` の `decideAccess` がルールのすべてで、検証済みのクレームだけを見ます。まず `email_verified` が true であること。`ALLOWED_EMAILS` にあるアドレスなら、アカウントの種類を問わず通します。ドメインでの許可には `hd` クレームが要ります。`hd` は Google が Workspace や Cloud Identity の管理対象アカウントにだけ付けるもので、`hd` かメールアドレスのドメインが `ALLOWED_DOMAINS` に完全一致すれば通します。`evil-example.com` や `example.com.evil` が `example.com` に一致することはありません。`alice@example.com` で登録した個人の Google アカウントには `hd` がないので、ドメインでは通りません。ボタンに渡す `hd` のヒントは Google のアカウント選択画面を絞るだけで、判定はサーバーがします。

### セッション

セッションは署名付き Cookie です（HS256、鍵は `AUTH_SECRET` から派生）。`HttpOnly` と `SameSite=Lax` は常に付き、https なら `Secure` と `__Host-` プレフィックスも付きます。有効期間は `SESSION_TTL_HOURS`（既定 12 時間）で、セッションストアはありません。許可リストは毎リクエスト評価し直すので、設定からアドレスやドメインを外して再起動すれば、その人は次のリクエストから締め出されます。Workspace 側で停止されたメンバーは、セッションが切れるまでは使えます。`AUTH_SECRET` を変えると全員がログアウトになります。

### リクエスト

GET と HEAD 以外のリクエストは、`Origin` ヘッダーが `APP_URL` と一致しないと拒否します。ログインの POST も同じです。アップロードのメタデータはクエリ文字列ではなく `X-Upload-Meta` ヘッダーで送るので、ファイル名やタグがプロキシや Cloud Run のリクエストログに残りません。ページには Content-Security-Policy を付けていて、スクリプトはアプリ自身と Google のログインとピッカーのオリジンからしか読み込みません。

### 削除

削除できるのは登録した本人か `ADMIN_EMAILS` の人だけで、それ以外は 403 になります。タグの編集は誰の画像でも全メンバーができます。削除は画像、記録の順に消し、以後そのリンクは 404 を返します。ただし、配布済みのコピーは回収できません。リンクは `Cache-Control: public, max-age=31536000, immutable` で配信しているので、ブラウザ、Google Chat、GitHub や Notion の画像プロキシ、CDN、Cloud Storage 側のキャッシュがしばらく画像を出し続けることがあります。削除の確認ダイアログにもそう書いてあります。どこかに貼った時点で、そのリンクは 1 年間は公開されたものと考えてください。

### 公開されるものとされないもの

画像オブジェクトにはカスタム メタデータも EXIF も付けません。登録した人、ファイル名、タグは記録にだけあり、記録は非公開バケットか `DATA_DIR/r/` にあります。ID は 80 ビットの乱数から作る 16 文字で、時刻から作ることはなく、公開バケットのロールには list がないので、外からライブラリを列挙する手段はありません。

### 画像データ

形式はバイト列から判定し、ファイル名や Content-Type は信用しません。SVG はスクリプトを含められるので拒否します。HEIC は同梱の libvips に HEVC デコーダーがないので拒否します。アップロードは `MAX_UPLOAD_MB` で打ち切ります。展開後の画素数が全フレーム合計で `IMAGE_MAX_INPUT_PIXELS` を超える画像は、デコードを始める前に拒否します。小さなファイルなのに展開するとギガバイト級になる、いわゆる画素爆弾への対策です。

### ブラウザに渡すもの

サーバーはページに `BootConfig` という JSON を埋め込みます。中身はアプリ名、言語、アップロード上限、OAuth クライアント ID、そしてドライブ取り込みが有効ならピッカーの API キーとプロジェクト番号です。クライアントのバンドルには設定値を一切焼き込んでおらず、秘密情報がブラウザに渡ることもありません。ピッカーの API キーは仕様上ブラウザ用のキーで、守っているのはリファラー制限です。

## 開発

Node 24 と pnpm が必要です。`corepack enable` で `package.json` に固定した pnpm が使えます。

```sh
git clone https://github.com/shngmsw/workspace-image-hub.git && cd workspace-image-hub
pnpm install
DEV_FAKE_LOGIN=alice@example.com pnpm dev
```

PowerShell では先に変数を入れます。`$env:DEV_FAKE_LOGIN = "alice@example.com"; pnpm dev` です。

`pnpm dev` は Vite と Hono のサーバーを同じプロセスで http://localhost:5173 に立て、画像は `./data` に保存します。`DEV_FAKE_LOGIN=<アドレス>` を付けると Google ログインを使わず、すべてのリクエストをそのアドレスの人として扱います。`AUTH_SECRET` と `GOOGLE_CLIENT_ID` には開発用の仮の値が入り、許可リストを何も設定していなければそのアドレスが許可されます。別の人として操作したいときは `X-Dev-User: bob@example.com` ヘッダーを付けます。管理者かどうかは `ADMIN_EMAILS` で決まります。

開発中に本物のログインボタンを使うなら、`DEV_FAKE_LOGIN` を外し、`AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`ALLOWED_DOMAINS` をシェルの環境変数で渡して、OAuth クライアントの JavaScript 生成元に `http://localhost:5173` を足します。開発サーバーが読むのはシェルの環境変数で、`.env` は読みません。

| コマンド | 内容 |
|---|---|
| `pnpm dev` | Vite の開発サーバー。API も同じプロセスで、ポート 5173。 |
| `pnpm build` | クライアントを `dist/client` に、サーバーを `dist/server/main.js` にビルドする。 |
| `pnpm start` | ビルド済みのサーバーをシェルの環境変数で起動する。既定のポートは 3000。 |
| `pnpm test` | Vitest で単体テストを実行する。`GCS_TEST_BUCKET=<バケット>` を付けると、ストアの契約テストをそのバケットに対しても実行する（認証は Application Default Credentials）。 |
| `pnpm lint`、`pnpm typecheck` | ESLint と `tsc --noEmit`。 |
| `pnpm gen:env-docs` | `ENV_VARS` から `.env.example` と両方の README の環境変数表を生成し直す。`--check` を付けると比較だけ行う。 |
| `pnpm smoke` | 起動中の開発サーバーに対する一通りの動作確認。 |

`pnpm smoke` は `DEV_FAKE_LOGIN` 付きで起動した開発サーバーに対して動きます。`curl`、`node`、POSIX の `sh` が必要で、Windows なら Git Bash で動きます。別のターミナルで `pnpm smoke` を実行すると、次の順に確かめます。

1. sharp で 3000×2000 の PNG を作ってアップロードし、結果が幅 1024px で元より小さいこと。
2. リンクを GET と HEAD で取得し、ステータスと `Content-Type`、`Content-Length`、`Cache-Control`。
3. 一覧に載っていること。タグの PATCH が反映されること。
4. `bob@example.com` として削除すると 403 になること。本人として 2 回削除すると両方 204 になること。
5. 最後に、消えたリンクが何を返すかを表示します。

`BASE=<URL>` で対象サーバーを変えられ、`KEEP=1` なら画像を消さずに残します。

CI（`.github/workflows/ci.yml`）は `main` への push と pull request で lint、typecheck、test、build、`pnpm gen:env-docs --check` を回します。`.github/workflows/docker.yml` は `main` への push と `v*` タグで linux/amd64 と linux/arm64 のイメージをビルドし、GHCR に push します。HTTP のルート一覧は `src/shared/api.ts` の `ROUTES` にあります。

## ライセンス

MIT ライセンスです。[LICENSE](LICENSE) を参照してください。

Google Workspace、Google Drive、Google Chat は Google LLC の商標です。このプロジェクトは Google とは無関係で、Google の承認や提携を受けたものではありません。
