# Spike: Copilot SDK in a Sandbox

Status: designed and coded, not yet run. Needs a Cloudflare account with Containers and a GitHub identity with Copilot access.

## Question

Can a Copilot CLI session inside a Cloudflare Sandbox edit a clone of the session fork, stream `assistant.message_delta` and `session.idle`, and get its change back into the fork?

## What the docs say

- Sandbox 1.0: a Durable Object owns a container through `ctx.container.start`, runs commands with `exec`, and can route all outbound HTTPS through a `WorkerEntrypoint` with `interceptOutboundHttps`. The container trusts `/etc/cloudflare/certs/cloudflare-containers-ca.crt`.
- Copilot SDK (`@github/copilot-sdk` 1.0.19): `new CopilotClient({ workingDirectory, gitHubToken })`, `createSession({ model, onPermissionRequest, systemMessage })`, `session.on(handler)`, `session.send({ prompt })`. Events include `assistant.message_delta`, `assistant.message`, `tool.execution_start`, `session.idle` and `session.error`.
- There is no Cloudflare guide for Copilot in a Sandbox.

## What was built

- `workers/sandbox/Dockerfile`: Node 24 with git, the sandbox shim, the Copilot SDK, and the template's dependencies preinstalled. Runs as a non-root user.
- `workers/sandbox/runner.mjs`: clones the fork, runs one Copilot session with the turn's prompt and the profile's instructions, prints each event as a JSON line, and on `session.idle` prints the changed files as `kargah.result`. It never commits or pushes.
- `workers/src/session-agent.ts`: `SessionAgent` starts the container and streams its stdout lines back as coder events. `SandboxOutbound` is the only network path: it blocks `git-receive-pack`, adds the read token for the Artifacts host, swaps a placeholder for the real Copilot token on Copilot hosts, and refuses every other host.
- `workers/src/sandbox-coder.ts`: `SandboxCoder` implements the `Coder` port, so the orchestrator commits the returned changes itself, one commit per turn with its note.

## Decision

The sandbox never holds a credential and cannot push. That is stronger than the spike asked for: the change comes back as data and the orchestrator writes the commit, so "pushed back" is done by code that already enforces write scope. If Copilot cannot run headless in the container, the fallback is another headless coding agent behind the same `Coder` interface.

## Open

- Whether the Copilot CLI accepts its token through the outbound header swap, or needs the real token in its environment.
- Whether `exec` streams stdout line by line or only at exit. If only at exit, events reach the dashboard per turn instead of live.
- `ctx.exports` with props for the outbound entrypoint is typed loosely in `session-agent.ts` and needs one run.
