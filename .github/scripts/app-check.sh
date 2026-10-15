#!/usr/bin/env bash
set -euo pipefail
url=$1
auth=$(bash "$(dirname "$0")/sign-in.sh" "$url")
project="appcheck-$(date +%s | tail -c 6)"
code() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
remove() { curl -sS -o /dev/null -X DELETE -H "$auth" -H 'content-type: application/json' -d "{\"confirm\":\"$project\"}" "$url/api/projects/$project" || true; }
trap remove EXIT
curl -fsS -m 600 -H "$auth" -H 'content-type: application/json' -d "{\"name\":\"$project\"}" -o /dev/null "$url/api/projects"
echo "made $project from the template; waiting for main's app"
state=""
for _ in $(seq 1 120); do
  state=$(curl -fsS -m 60 -H "$auth" "$url/app/$project/main?state=1" || echo '{"status":"unreachable"}')
  status=$(echo "$state" | jq -r .status)
  case "$status" in
    ready) break ;;
    failed | no-stack | missing) echo "main's app is $status: $(echo "$state" | jq -r '.error // empty')"; exit 1 ;;
  esac
  sleep 10
done
test "$(echo "$state" | jq -r .status)" = ready
enter=$(echo "$state" | jq -r .enter)
address=$(echo "$state" | jq -r .url)
echo "main's app runs at $address"
test "$(code -m 60 "$address/")" = 401
jar=$(mktemp)
answer=$(curl -sS -m 120 -L -c "$jar" -b "$jar" -o /dev/null -w '%{http_code}' "$enter")
rm -f "$jar"
echo "opening main's app through its enter link answered $answer"
test "$answer" = 200
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${NAME:-}" ]; then
  api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/durable_objects/namespaces"
  namespaces=$(curl -fsS -H "authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api?per_page=1000")
  stored() {
    ns=$(echo "$namespaces" | jq -r --arg s "$NAME" --arg c "$1" '.result[] | select(.script == $s and .class == $c) | .id')
    curl -fsS -H "authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api/$ns/objects?limit=10000" | jq '[.result[] | select(.hasStoredData)] | length'
  }
  sessions=$(stored SessionAgent)
  kept=$(stored ImageLayers)
  echo "sandboxes with stored state: $sessions; the image cache holds $kept layers and manifests"
  test "$kept" -gt 0
fi
