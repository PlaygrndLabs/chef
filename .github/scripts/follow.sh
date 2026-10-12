#!/usr/bin/env bash
set -u
auth="authorization: Bearer $CHEF_PASSWORD"
api="$CHEF_URL/api/projects/$PROJECT"
curl -sS -m 120 -X POST -H "$auth" "$api/bootstrap"; echo
curl -sS -m 120 -X POST -H "$auth" -H 'content-type: application/json' -d "$(jq -n --arg prompt "$PROMPT" '{prompt: $prompt}')" "$api/prompts"; echo
last=0
end=$((SECONDS + MINUTES * 60))
while [ $SECONDS -lt $end ]; do
  events=$(curl -sS -m 60 -H "$auth" "$api/events?after=$last" || echo '[]')
  if [ "$(echo "$events" | jq 'length' 2>/dev/null || echo 0)" != "0" ]; then
    echo "$events" | jq -r '.[] | select(.event.type != "assistant.message_delta" and .event.type != "tool.execution_start") | "\(.seq) \(.event.type) \(.event.sessionId // "") \(.event.from // "")->\(.event.to // "") \(.event.reason // .event.url // .event.message // .event.summary // "" | tostring | .[0:1500])"'
    last=$(echo "$events" | jq '.[-1].seq')
  fi
  states=$(curl -sS -m 60 -H "$auth" "$api/sessions" | jq -r '[.[].machine.state] | join(",")' 2>/dev/null)
  case "$states" in
    *queued*|*planning*|*testing*|*coding*|*reviewing*|*gating*|*syncing*|"") ;;
    *) echo "final states: $states"; case "$states" in *merged*) exit 0;; *) exit 1;; esac ;;
  esac
  sleep 20
done
echo "still running after $MINUTES minutes: $states"
exit 1
