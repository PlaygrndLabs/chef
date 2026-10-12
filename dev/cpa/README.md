# Local CPA

chef's planner and reviewer reach Claude through a local [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (CPA), the same proxy nocheh uses, pinned to the same revision. CPA holds one Claude subscription login and serves the Anthropic Messages API on `http://127.0.0.1:8327/v1/messages` to clients that present a local key. This instance is chef's own; it does not share nocheh's login or config, and it publishes host port 8327 so it can run next to another CPA on the default port 8317.

## Set up once

```
node --import tsx cli/src/bin.ts cpa init        # writes dev/cpa/state/config.yaml and workers/.dev.vars with a new local key; rerun it to point an older .dev.vars at port 8327
docker compose -f dev/cpa/compose.yaml build
docker compose -f dev/cpa/compose.yaml run --rm --service-ports login
```

The login prints a URL. Open it, sign in to Claude, and the browser returns to `localhost:54545`, which the login container receives. The login is saved in `dev/cpa/state/auth/`.

The login needs port 54545 on the host, because Claude's sign-in returns to `localhost:54545`. If Docker reports `Bind for 127.0.0.1:54545 failed: port is already allocated` (another app's CPA, such as nocheh's, holds it), log in without publishing the port:

```
docker compose -f dev/cpa/compose.yaml run --rm login
```

Open the URL it prints and sign in. The browser then goes to `localhost:54545/callback?...`, which reaches the other app and may show an error page; that is expected. Copy that whole address from the browser's address bar. After 15 seconds the login asks `Paste the Claude callback URL`; paste it and press Enter. The other app cannot use the address, because only this login holds the matching state and PKCE verifier.

## Run

```
docker compose -f dev/cpa/compose.yaml up -d --wait cpa
set -a; . workers/.dev.vars; set +a
node --import tsx cli/src/bin.ts llm check
```

`llm check` runs the planner's triage and plan for "Add an item to a todo list" and the reviewer on the todo fixture, through CPA.

`dev/cpa/state/` is ignored by git. The key in it is local to this machine.

## From Cloudflare

A deployed Worker cannot reach `127.0.0.1`. Expose CPA with a Cloudflare Tunnel and set the Worker secrets `CPA_BASE_URL` to the tunnel URL and `CPA_API_KEY` to the key from `dev/cpa/state/config.yaml`.
