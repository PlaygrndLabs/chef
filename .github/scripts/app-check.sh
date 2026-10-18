#!/usr/bin/env bash
set -euo pipefail
url=$1
auth=$(bash "$(dirname "$0")/sign-in.sh" "$url")
project="appcheck-$(date +%s | tail -c 6)"
code() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
tailer=""
remove() {
  [ -z "$tailer" ] || kill "$tailer" 2>/dev/null || true
  curl -sS -o /dev/null -X DELETE -H "$auth" -H 'content-type: application/json' -d "{\"confirm\":\"$project\"}" "$url/api/projects/$project" || true
}
trap remove EXIT
watch=""
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${NAME:-}" ]; then
  watch=$(mktemp)
  ./node_modules/.bin/wrangler tail "$NAME" --format json > "$watch" 2> /dev/null &
  tailer=$!
  sleep 10
fi
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
if [ -n "$watch" ]; then
  sleep 5
  kill "$tailer" 2>/dev/null || true
  tailer=""
  cache='select((.event.request.url? // "") | contains("198.18.0.1"))'
  echo "requests from the sandbox's Docker Hub mirror to the image cache:"
  jq -r "$cache"' | "\(.event.request.method) \(.event.request.url | sub("^http://[^/]+"; "") | sub("[?:].*"; "")) \(.event.response.status // .outcome)"' "$watch" | sort | uniq -c
  jq -r "$cache"' | .exceptions[]?.message' "$watch" | sort | uniq -c
  test "$(jq -r "$cache"' | select((.event.request.method == "PUT" and .event.response.status == 201) or ((.event.request.url | contains("/blobs/")) and .event.request.method == "GET" and .event.response.status == 200)) | 1' "$watch" | wc -l)" -gt 0
fi
