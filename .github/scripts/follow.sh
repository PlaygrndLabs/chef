#!/usr/bin/env bash
set -u
auth=$(bash "$(dirname "$0")/sign-in.sh" "$CHEF_URL") || exit 1
api="$CHEF_URL/api/projects/$PROJECT"
put_env() {
  body=$(printf '%s\n' $1 | jq -Rn '[inputs | select(length > 0) | capture("^(?<k>[A-Z][A-Z0-9_]*)=(?<v>.*)$")] | {set: (map({key: .k, value: {value: .v, secret: true}}) | from_entries)}')
  curl -sS -m 120 -X PUT -H "$auth" -H 'content-type: application/json' -d "$body" "$api/env" | jq -c '{vars: [.vars[] | {name, secret, value}], needs}'
}
check_preview() {
  feature=$(curl -sS -m 60 -H "$auth" "$api/sessions" | jq -r '[.[] | select(.machine.state == "merged")][-1].featureId')
  for _ in $(seq 1 30); do
    page=$(curl -sSL -b "" -m 120 -H "$auth" "$CHEF_URL/preview/$PROJECT/$feature?path=$CHECK_PATH")
    case "$page" in *"Waking up"*) sleep 10 ;; *) break ;; esac
  done
  echo "$page" | head -c 2000; echo
  case "$page" in *"$CHECK_TEXT"*) echo "preview $CHECK_PATH shows $CHECK_TEXT"; return 0 ;; *) echo "preview $CHECK_PATH does not show $CHECK_TEXT"; return 1 ;; esac
}
curl -sS -m 300 -X POST -H "$auth" -H 'content-type: application/json' -d "$(jq -n --arg name "$PROJECT" '{name: $name}')" "$CHEF_URL/api/projects"; echo
[ -n "${ENV_NOW:-}" ] && put_env "$ENV_NOW"
later_done=""
curl -sS -m 120 -X POST -H "$auth" -H 'content-type: application/json' -d "$(jq -n --arg prompt "$PROMPT" '{prompt: $prompt}')" "$api/prompts"; echo
last=0
end=$((SECONDS + MINUTES * 60))
while [ $SECONDS -lt $end ]; do
  events=$(curl -sS -m 60 -H "$auth" "$api/events?after=$last" || echo '[]')
  if [ "$(echo "$events" | jq 'length' 2>/dev/null || echo 0)" != "0" ]; then
    [ -n "${EVENTS_FILE:-}" ] && echo "$events" | jq -c '.[]' >> "$EVENTS_FILE"
    echo "$events" | jq -r '.[] | select(.event.type != "assistant.message_delta" and .event.type != "tool.execution_start") | "\((.event.at // 0) / 1000 | strftime("%H:%M:%S")) \(.seq) \(.event.type) \(.event.sessionId // "") \(.event.from // "")->\(.event.to // "") \(.event.reason // .event.url // .event.message // .event.summary // "" | tostring | .[0:1500])"'
    last=$(echo "$events" | jq '.[-1].seq')
  fi
  sessions=$(curl -sS -m 60 -H "$auth" "$api/sessions" || echo '[]')
  [ -n "${EVENTS_FILE:-}" ] && echo "$sessions" > "$(dirname "$EVENTS_FILE")/sessions.json"
  states=$(echo "$sessions" | jq -r '[.[].machine.state] | join(",")' 2>/dev/null)
  waiting=$(echo "$sessions" | jq -r '[.[] | select(.machine.state != "merged" and .machine.state != "stuck" and .machine.state != "dropped") | (.needs // [])[]] | join(",")' 2>/dev/null)
  if [ -n "$waiting" ]; then
    echo "waiting for keys: $waiting"
    if [ -n "${ENV_LATER:-}" ] && [ -z "$later_done" ]; then put_env "$ENV_LATER"; later_done=1; fi
  fi
  case "$states" in
    *queued*|*planning*|*testing*|*coding*|*reviewing*|*gating*|*syncing*|"") ;;
    *) echo "final states: $states"; case "$states" in *merged*) if [ -n "${CHECK_PATH:-}" ]; then check_preview; exit $?; fi; exit 0;; *) exit 1;; esac ;;
  esac
  sleep 20
done
echo "still running after $MINUTES minutes: $states"
exit 1
