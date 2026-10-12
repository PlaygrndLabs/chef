# Spike: coder in a Sandbox

Status: the runner works headless against a Claude-compatible endpoint (`cli/test/e2e/coder-runner.test.ts`); not yet run inside a Cloudflare Sandbox. Needs a Cloudflare account with Containers and the CPA gateway.

## Question

Can a coding agent inside a Cloudflare Sandbox edit a clone of the session fork, stream `assistant.message_delta` and `session.idle`, and get its change back into the fork?

## History

The first version ran the GitHub Copilot SDK. That came from reading "copilot" in the concept as GitHub Copilot; it meant CopilotKit, the layer that streams sessions to the app. The coder is now the Claude Agent SDK, so it reaches Claude through the same CPA gateway as the planner and reviewer and needs no GitHub token.

## What the docs say

- Sandbox 1.0: a Durable Object owns a container through `ctx.container.start`, runs commands with `exec`, and can route all outbound HTTPS through a `WorkerEntrypoint` with `interceptOutboundHttps`. The container trusts `/etc/cloudflare/certs/cloudflare-containers-ca.crt`.
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.284): `query({ prompt, options })` runs the Claude Code engine in a child process. `options.agents` and `options.agent` select a named subagent with its own prompt and tools, `includePartialMessages` streams raw message deltas, `canUseTool` approves each tool call, and `env` sets `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`.

## What was built

- `workers/sandbox/Dockerfile`: Node 24 with git, the sandbox shim, the Agent SDK with its native binary, and the template's dependencies preinstalled. Runs as a non-root user.
- `workers/sandbox/runner.mjs`: clones the fork, runs one query under the profile's subagent `kargah-<role>`, maps text deltas to `assistant.message_delta` and tool starts to `tool.execution_start`, and on success prints `session.idle` and the changed files as `kargah.result` with token usage. It never commits or pushes.
- `workers/src/session-agent.ts`: `SessionAgent` starts the container and streams its stdout lines back as coder events. `SandboxOutbound` is the only network path: it blocks `git-receive-pack`, adds the read token for the Artifacts host, swaps the placeholder API key for `CPA_API_KEY` on the CPA gateway's host, and refuses every other host.
- `workers/src/sandbox-coder.ts`: `SandboxCoder` implements the `Coder` port and resolves the profile model `coder-default` to `CODER_MODEL`.

## Evidence

`cli/test/e2e/coder-runner.test.ts` runs the real runner and the real Agent SDK binary against a local fake of the Messages API. The agent calls `Write`, the runner streams the text delta and the tool start, and returns the new file. Every `/v1/` request carries the placeholder key, never a real one.

## Decision

The sandbox never holds a credential and cannot push. The change comes back as data and the orchestrator writes the commit, so "pushed back" is done by code that already enforces write scope.

## Open

- Whether `exec` streams stdout line by line or only at exit. If only at exit, events reach the app per turn instead of live.
- `ctx.exports` with props for the outbound entrypoint is typed loosely in `session-agent.ts` and needs one run.
