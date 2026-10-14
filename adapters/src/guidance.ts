import { learnedRules, MAX_INSTRUCTIONS_CHARS, memoryEntries, projectGuidance, type EditResult, type GuidanceEdit, type LearnedRule, type MemoryEntry, type Tree } from "@chef/core";

export interface SharedInstructions {
  readonly text: string;
  readonly at: number;
}

export interface GuidanceHost {
  main(): Promise<{ readonly commitId: string | null; readonly tree: Tree }>;
  edit(edit: GuidanceEdit): Promise<EditResult & { readonly commitId?: string }>;
  shared(): Promise<SharedInstructions | null>;
}

export interface InstructionsView {
  readonly goal: string;
  readonly instructions: string;
  readonly shared: string;
  readonly commitId: string | null;
}

export interface MemoryView {
  readonly commitId: string | null;
  readonly entries: readonly MemoryEntry[];
  readonly rules: readonly LearnedRule[];
}

const text = (value: unknown): value is string => typeof value === "string";

async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => null);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

async function instructionsView(host: GuidanceHost): Promise<InstructionsView> {
  const { commitId, tree } = await host.main();
  return { ...projectGuidance(tree), shared: (await host.shared())?.text ?? "", commitId };
}

async function memoryView(host: GuidanceHost): Promise<MemoryView> {
  const { commitId, tree } = await host.main();
  return { commitId, entries: memoryEntries(tree), rules: learnedRules(tree) };
}

function failed(result: EditResult): Response | null {
  return result.ok ? null : Response.json({ error: result.error }, { status: result.status });
}

export async function instructionsRequest(request: Request, host: GuidanceHost): Promise<Response> {
  if (request.method === "GET") return Response.json(await instructionsView(host));
  if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
  const input = await body(request);
  const previous = input["previous"] as Record<string, unknown> | undefined;
  if (!text(input["goal"]) || !text(input["instructions"]) || !text(previous?.["goal"]) || !text(previous["instructions"])) return Response.json({ error: "send goal, instructions and the previous values" }, { status: 400 });
  const result = await host.edit({ kind: "instructions", goal: input["goal"], instructions: input["instructions"], previous: { goal: previous["goal"], instructions: previous["instructions"] } });
  return failed(result) ?? Response.json(await instructionsView(host));
}

export async function memoryRequest(request: Request, host: GuidanceHost): Promise<Response> {
  if (request.method === "GET") return Response.json(await memoryView(host));
  const input = await body(request);
  if (request.method === "POST") {
    if (!text(input["title"]) || !text(input["text"])) return Response.json({ error: "send a title and the text" }, { status: 400 });
    const result = await host.edit({ kind: "note", title: input["title"], text: input["text"] });
    return failed(result) ?? Response.json({ ...(await memoryView(host)), path: result.ok ? (result.path ?? null) : null }, { status: 201 });
  }
  if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
  const value = input["text"];
  if (!text(input["path"]) || !text(input["previous"]) || !(value === null || text(value))) return Response.json({ error: "send the path, the new text (or null to remove it) and the previous text" }, { status: 400 });
  const result = await host.edit({ kind: "memory", path: input["path"], text: value, previous: input["previous"] });
  return failed(result) ?? Response.json(await memoryView(host));
}

export interface SharedInstructionsStore {
  get(): Promise<SharedInstructions | null>;
  put(value: SharedInstructions): Promise<void>;
}

export async function sharedInstructionsRequest(request: Request, store: SharedInstructionsStore, now: () => number = Date.now): Promise<Response> {
  const current = (await store.get()) ?? { text: "", at: 0 };
  if (request.method === "GET") return Response.json(current);
  if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
  const input = await body(request);
  if (!text(input["text"]) || !text(input["previous"])) return Response.json({ error: "send the text and the previous text" }, { status: 400 });
  if (input["previous"].trim() !== current.text) return Response.json({ error: "the instructions were changed meanwhile, so reload and make your change again" }, { status: 409 });
  const next = input["text"].trim();
  if (next.length > MAX_INSTRUCTIONS_CHARS) return Response.json({ error: `keep the instructions under ${MAX_INSTRUCTIONS_CHARS} characters` }, { status: 400 });
  const saved = { text: next, at: now() };
  await store.put(saved);
  return Response.json(saved);
}
