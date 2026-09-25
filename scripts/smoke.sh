#!/usr/bin/env sh
# End-to-end smoke test over HTTP with curl, against a running dev server:
#
#   DEV_FAKE_LOGIN=alice@example.com pnpm dev      # then, in another shell:
#   sh scripts/smoke.sh                            # BASE=http://localhost:5173 by default
#
# Uploads a generated 3000x2000 PNG, checks the WebP link, lists, edits tags, and checks the
# delete policy (another member is refused; the owner deletes; a second delete is still 204).
# KEEP=1 skips the owner's delete, so the image can be checked against another server afterwards.
set -eu

BASE=${BASE:-http://localhost:5173}
OWNER=${OWNER:-alice@example.com}
OTHER=${OTHER:-bob@example.com}
# Relative, so node and curl agree on the path even under Git Bash on Windows.
TMP=$(mktemp -d ./.smoke.XXXXXX)
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
# process.stdout.write, not console.log: FORCE_COLOR would wrap numbers in ANSI codes.
json() { node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String($1))"; }
header() { tr -d '\r' < "$1" | grep -i "^$2:" | head -n 1 | cut -d' ' -f2-; }

# A file, not `node -e`: some Windows node shims cut multi-line arguments at the first newline.
cat > "$TMP/gen.mjs" <<EOF
import sharp from "sharp";
const seed = await sharp({ create: { width: 250, height: 167, channels: 3, background: "#000", noise: { type: "gaussian", mean: 128, sigma: 70 } } }).png().toBuffer();
await sharp(seed).resize(3000, 2000, { kernel: "cubic" }).png().toFile("$TMP/big.png");
EOF
node "$TMP/gen.mjs"
META=$(node -e "console.log(Buffer.from(JSON.stringify({filename:'smoke-3000x2000.png',source:'upload',tags:['smoke']})).toString('base64url'))")

echo "== upload"
status=$(curl -s -o "$TMP/asset.json" -w '%{http_code}' -X POST "$BASE/api/assets" \
  -H "Origin: $BASE" -H "X-Upload-Meta: $META" -H "Content-Type: application/octet-stream" \
  --data-binary "@$TMP/big.png")
[ "$status" = 201 ] || fail "upload returned $status: $(cat "$TMP/asset.json")"
json 'JSON.stringify({id:v.id,url:v.url,width:v.width,height:v.height,originalBytes:v.originalBytes,storedBytes:v.storedBytes,tags:v.tags})' < "$TMP/asset.json"; echo
ID=$(json v.id < "$TMP/asset.json")
URL=$(json v.url < "$TMP/asset.json")
[ "$(json v.width < "$TMP/asset.json")" = 1024 ] || fail "width is not 1024"
[ "$(json 'v.storedBytes < v.originalBytes' < "$TMP/asset.json")" = true ] || fail "stored is not smaller"

for method in GET HEAD; do
  echo "== $method $URL"
  if [ "$method" = HEAD ]; then curl -s -I "$URL" > "$TMP/h"; else curl -s -D "$TMP/h" -o "$TMP/body" "$URL"; fi
  head -n 1 "$TMP/h" | tr -d '\r'
  for h in Content-Type Content-Length Cache-Control ETag; do echo "$h: $(header "$TMP/h" "$h")"; done
  head -n 1 "$TMP/h" | grep -q ' 200' || fail "$method status"
  [ "$(header "$TMP/h" Content-Type)" = image/webp ] || fail "$method content-type"
  header "$TMP/h" Cache-Control | grep -q immutable || fail "$method cache-control"
  [ "$(header "$TMP/h" Content-Length)" = "$(json v.storedBytes < "$TMP/asset.json")" ] || fail "$method content-length"
done

echo "== list"
curl -s "$BASE/api/assets" > "$TMP/list.json"
[ "$(json "v.assets.some(a => a.id === '$ID')" < "$TMP/list.json")" = true ] || fail "list does not show $ID"
echo "listed: $ID (of $(json v.assets.length < "$TMP/list.json"))"

echo "== patch tags"
curl -s -X PATCH "$BASE/api/assets/$ID" -H "Origin: $BASE" -H "Content-Type: application/json" \
  --data '{"tags":["smoke","ChatIcon"]}' > "$TMP/patched.json"
json 'JSON.stringify(v.tags)' < "$TMP/patched.json"; echo
[ "$(json 'v.tags.join(",")' < "$TMP/patched.json")" = "smoke,ChatIcon" ] || fail "patch"

echo "== delete as $OTHER"
status=$(curl -s -o "$TMP/del.json" -w '%{http_code}' -X DELETE "$BASE/api/assets/$ID" -H "Origin: $BASE" -H "X-Dev-User: $OTHER")
echo "$status $(cat "$TMP/del.json")"
[ "$status" = 403 ] || fail "other member could delete"

if [ "${KEEP:-0}" = 1 ]; then echo "kept $ID for later checks"; echo "ID=$ID"; exit 0; fi

echo "== delete as $OWNER, twice"
for n in 1 2; do
  status=$(curl -s -o "$TMP/discard" -w '%{http_code}' -X DELETE "$BASE/api/assets/$ID" -H "Origin: $BASE")
  echo "delete $n: $status"
  [ "$status" = 204 ] || fail "owner delete $n"
done
status=$(curl -s -o "$TMP/discard" -w '%{http_code}' "$URL")
echo "after delete GET: $status"
echo "OK"
