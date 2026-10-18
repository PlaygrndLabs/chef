#!/usr/bin/env bash
set -euo pipefail
url=$1
auth=$(bash "$(dirname "$0")/sign-in.sh" "$url")
code() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
test "$(code "$url/s")" = 200
script=$(curl -fsS "$url/s" | grep -o 'src="/assets/[^"]*\.js"' | head -1 | cut -d'"' -f2)
curl -fsS -o /dev/null -w '%{content_type}\n' "$url$script" | grep -q javascript
project=$(curl -fsS -H "$auth" "$url/api/projects" | jq -r '.projects[0].name // empty')
session=""
if [ -n "$project" ]; then session=$(curl -fsS -H "$auth" "$url/api/projects/$project/sessions" | jq -r '.[-1].id // empty'); fi
if [ -z "$session" ]; then
  echo "no session to share yet, so the share check only opened the share page"
  exit 0
fi
made=$(curl -fsS -w '\n%{http_code}' -H "$auth" -H 'content-type: application/json' -d "{\"kind\":\"session\",\"id\":\"$session\",\"expiresInDays\":1}" "$url/api/projects/$project/shares")
status=$(echo "$made" | tail -1)
made=$(echo "$made" | head -n -1)
token=$(echo "$made" | jq -r .token)
share=$(echo "$made" | jq -r .share.shareId)
bearer="authorization: Bearer $token"
test "$(curl -fsS -H "$bearer" "$url/api/share" | jq -r .id)" = "$session"
test "$(code -H "$bearer" "$url/api/projects/$project/sessions/$session")" = 200
test "$(code -H "$bearer" "$url/api/projects/$project/sessions/$session/changes")" = 200
test "$(code -H "$bearer" "$url/api/projects/$project/sessions/$session/events")" = 200
test "$(code -H "$bearer" "$url/api/projects")" = 403
test "$(code -H "$bearer" "$url/api/projects/$project/spec")" = 403
test "$(code -H "$bearer" -X POST "$url/api/projects/$project/sessions/$session/steer")" = 403
test "$(code -H "$bearer" "$url/api/keys")" = 403
again=$(curl -fsS -H "$auth" -H 'content-type: application/json' -d "{\"kind\":\"session\",\"id\":\"$session\",\"expiresInDays\":1}" "$url/api/projects/$project/shares")
test "$(echo "$again" | jq -r .token)" = "$token"
if [ "$status" != 201 ]; then
  echo "the build already had a link, so the check left it on and opened only that session with it"
  exit 0
fi
test "$(code -H "$auth" -X DELETE "$url/api/shares/$share")" = 204
test "$(code -H "$bearer" "$url/api/share")" = 401
echo "a share link for $project/$session opened only that session and stopped once it ended"
