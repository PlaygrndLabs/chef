#!/usr/bin/env bash
set -u
auth="authorization: Bearer $CHEF_PASSWORD"
api="$CHEF_URL/api/projects/$PROJECT"
deploy() {
  echo "::group::deploy $NAME while a turn runs"
  pnpm run deploy --name "$NAME" --secrets-file "$SECRETS" > "$RUNNER_TEMP/redeploy.log" 2>&1 || { tail -40 "$RUNNER_TEMP/redeploy.log"; exit 1; }
  tail -5 "$RUNNER_TEMP/redeploy.log"
  echo "::endgroup::"
}
curl -sS -m 120 -X POST -H "$auth" "$api/bootstrap"; echo
curl -sS -m 120 -X POST -H "$auth" -H 'content-type: application/json' -d "$(jq -n --arg prompt "$PROMPT" '{prompt: $prompt}')" "$api/prompts"; echo
: > "$RUNNER_TEMP/events.jsonl"
last=0
deploys=0
turn_started=0
end=$((SECONDS + MINUTES * 60))
states=""
while [ $SECONDS -lt $end ]; do
  events=$(curl -sS -m 60 -H "$auth" "$api/events?after=$last" || echo '[]')
  if [ "$(echo "$events" | jq 'length' 2>/dev/null || echo 0)" != "0" ]; then
    echo "$events" | jq -c '.[]' >> "$RUNNER_TEMP/events.jsonl"
    echo "$events" | jq -r '.[] | select(.event.type != "coder.event" or .event.event.type == "session.error" or .event.event.type == "tool.execution_start") | "\(.seq) \(.event.type) \(.event.role // .event.event.tool // "") \(.event.from // "")->\(.event.to // "") \(.event.reason // .event.event.message // .event.event.detail // .event.summary // "" | tostring | .[0:200])"'
    last=$(echo "$events" | jq '.[-1].seq')
    if echo "$events" | jq -e '[.[] | select(.event.type == "agent.started" and .event.role != "planner" and .event.role != "reviewer")] | length > 0' > /dev/null; then turn_started=$SECONDS; fi
  fi
  if [ "$deploys" -lt "$DEPLOYS" ] && [ "$turn_started" -gt 0 ] && [ $((SECONDS - turn_started)) -ge 75 ]; then
    deploys=$((deploys + 1))
    turn_started=0
    deploy
  fi
  states=$(curl -sS -m 60 -H "$auth" "$api/sessions" | jq -r '[.[].machine.state] | join(",")' 2>/dev/null)
  case "$states" in
    *queued*|*planning*|*testing*|*coding*|*reviewing*|*gating*|*syncing*|"") ;;
    *) break ;;
  esac
  sleep 15
done
echo "final states: $states after $deploys deploys"
jq -r 'select(.event.type == "agent.started") | .event.role' "$RUNNER_TEMP/events.jsonl" | sort | uniq -c | sed 's/^/turns started: /'
jq -r 'select(.event.type == "turn.rejected") | "\(.event.role) \(.event.rule)"' "$RUNNER_TEMP/events.jsonl" | sed 's/^/rejected: /'
restarts=$(jq -r 'select(.event.type == "coder.event" and .event.event.type == "session.error") | .event.event.message' "$RUNNER_TEMP/events.jsonl" | tee /dev/stderr | grep -c "starts again")
echo "turns started again after a stop: $restarts"
case "$states" in *merged*) ;; *) exit 1 ;; esac
[ "$deploys" -ge "$DEPLOYS" ] && [ "$restarts" = "0" ]
