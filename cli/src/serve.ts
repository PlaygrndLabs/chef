import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { isTerminal, parseFeature, type FeatureSpec } from "@kargah/core";
import type { Script } from "@kargah/core/fakes";
import { KargahAgent, type KargahLink } from "@kargah/adapters/agui";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { createNodeFetchHandler } from "@copilotkit/runtime/v2/node";
import { benchScript } from "./bench/agent.ts";
import { BENCH_ITEMS, promptFor, specFor } from "./bench/items.ts";
import { demoScript } from "./demo.ts";
import { readTree } from "./fs.ts";
import { localWorld, REPO_ROOT, templateTree } from "./world.ts";

export const TODO_PROMPT = "Add an item to a todo list";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

function presets(): Map<string, FeatureSpec> {
  const todo = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
  if (!todo.ok) throw new Error(todo.errors.join("\n"));
  return new Map<string, FeatureSpec>([[TODO_PROMPT, todo.spec], ...BENCH_ITEMS.map((item) => [promptFor(item), specFor(item)] as const)]);
}

function script(): Script {
  const todo = demoScript(readTree(join(REPO_ROOT, "core", "test", "fixtures", "todo")));
  const bench = benchScript(BENCH_ITEMS);
  return (input, attempt) => (input.featureId === "todo-add" ? todo(input, attempt) : bench(input, attempt));
}

export interface LocalServer {
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

export async function serve(options: { readonly port: number; readonly project: string; readonly real: boolean; readonly assets?: string; readonly log?: (line: string) => void }): Promise<LocalServer> {
  const log = options.log ?? (() => {});
  const w = localWorld({ script: script(), presets: presets(), real: options.real });
  await w.orchestrator.bootstrap(templateTree());
  let driving: Promise<void> | null = null;
  const drive = () => {
    driving ??= (async () => {
      while ((await w.orchestrator.sessions()).some((s) => !isTerminal(s.machine.state))) await w.orchestrator.drain(1);
    })()
      .catch((error: unknown) => log(`drive failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        driving = null;
      });
  };
  const link: KargahLink = {
    cursor: async () => w.bus.log.length,
    submit: async (prompt) => {
      const result = await w.orchestrator.submit(prompt);
      if (result.sessionId) drive();
      return result;
    },
    events: async (after) => w.bus.log.slice(after, after + 500).map((event, i) => ({ seq: after + i + 1, event })),
  };
  const base = `/api/projects/${options.project}`;
  process.env["COPILOTKIT_TELEMETRY_DISABLED"] ??= "true";
  const runtime = new CopilotRuntime({ agents: () => ({ default: new KargahAgent({ link, pollMs: 200 }) }) });
  const copilot = createCopilotRuntimeHandler({ runtime, basePath: `${base}/copilotkit` });
  const assets = options.assets ?? join(REPO_ROOT, "apps", "dashboard", "dist");
  if (!existsSync(join(assets, "index.html"))) log(`no dashboard build in ${assets}; run pnpm build`);

  const api = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname.startsWith(`${base}/copilotkit`)) return copilot(request);
    if (url.pathname.startsWith("/api/")) {
      const action = url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length + 1) : null;
      if (request.method === "POST" && action === "bootstrap") return Response.json({ commitId: (await w.orchestrator.mainTree()).commitId, created: false });
      if (request.method === "POST" && action === "prompts") {
        const { prompt } = (await request.json()) as { prompt?: string };
        if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
        return Response.json(await link.submit(prompt.trim()), { status: 202 });
      }
      if (request.method === "GET" && action === "sessions") return Response.json(await w.orchestrator.sessions());
      if (request.method === "GET" && action === "events") return Response.json(await link.events(Number(url.searchParams.get("after") ?? 0)));
      if (request.method === "GET" && action === "cursor") return Response.json({ seq: await link.cursor() });
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(assets, path);
    if (!file.startsWith(assets) || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
    return new Response(readFileSync(file), { headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream" } });
  };

  const server = createServer(createNodeFetchHandler(api));
  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
