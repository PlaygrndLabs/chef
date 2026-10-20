import { describe, expect, it } from "vitest";
import type { AppHost, AppRun } from "../../src/ports/app-host.ts";
import type { Script } from "../../src/fakes/index.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const PROMPT = "Add an item to a todo list";
const BUILD_ERROR = 'the app did not start: app logged an error before it answered on port 8787: ✘ [ERROR] Could not resolve "../page.ts" features/todo-add/index.ts:31';

class ScriptedAppHost implements AppHost {
  readonly runs: string[] = [];
  failures = 0;
  private readonly inFlight = new Map<string, Promise<AppRun>>();

  constructor(
    private readonly status: "running" | "no-stack" = "running",
    private readonly delayMs = 0,
  ) {}

  run(input: { readonly target: string; readonly commitId: string }): Promise<AppRun> {
    const joined = this.inFlight.get(input.commitId);
    if (joined) return joined;
    const run = this.start(input).finally(() => this.inFlight.delete(input.commitId));
    this.inFlight.set(input.commitId, run);
    return run;
  }

  private async start(input: { readonly target: string; readonly commitId: string }): Promise<AppRun> {
    this.runs.push(input.commitId);
    const fails = this.failures > 0;
    if (fails) this.failures--;
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (fails) {
      return { status: "failed", url: null, local: null, commitId: input.commitId, error: BUILD_ERROR };
    }
    if (this.status === "no-stack") return { status: "no-stack", url: null, local: null, commitId: input.commitId };
    return { status: "running", url: `https://${input.target}.app.example`, local: `http://${input.target}.local.example`, commitId: input.commitId };
  }
}

function breaking(apps: ScriptedAppHost, failingTurns: number): Script {
  const base = scriptFromFixture(fixture("todo"));
  return async (input, attempt) => {
    const turn = await base(input, attempt);
    if (input.role !== "backend") return turn;
    if (attempt <= failingTurns) apps.failures = 1;
    return { ...turn, changes: Object.fromEntries(Object.entries(turn.changes).map(([path, content]) => [path, content === null ? null : `${content}${"\n".repeat(attempt - 1)}`])) };
  };
}

function setup(apps: ScriptedAppHost, script: Script, background = false) {
  return world({ script, presets: new Map([[PROMPT, todoSpec]]), deps: { apps, ...(background ? { background: (work: () => Promise<void>) => void work() } : {}) } });
}

describe("app start in the session flow", () => {
  it("sends a failed app start back to the roles as feedback and does not review until the app starts", async () => {
    const apps = new ScriptedAppHost();
    const w = setup(apps, breaking(apps, 1));
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");

    const backend = w.coder.turns.filter((t) => t.role === "backend");
    expect(backend).toHaveLength(2);
    expect(backend[0]?.prompt).not.toContain("did not start");
    expect(backend[1]?.prompt).toContain("The app did not start on the latest commit");
    expect(backend[1]?.prompt).toContain('Could not resolve "../page.ts"');

    const states = w.bus.log.flatMap((e) => (e.type === "session.state" ? [`${e.from}>${e.to}:${e.reason}`] : []));
    expect(states).toContain("coding>coding:app_failed");
    const order = w.bus.log.flatMap((e) => (e.type === "agent.started" && (e.role === "backend" || e.role === "reviewer") ? [e.role] : e.type === "session.state" && e.to === "reviewing" ? ["reviewing"] : []));
    expect(order.slice(0, 4)).toEqual(["backend", "backend", "reviewing", "reviewer"]);
    expect(w.bus.log.filter((e) => e.type === "review.verdict")).toHaveLength(1);
    expect(record.history.some((h) => h.includes("The app did not start"))).toBe(true);
  });

  it("waits for the head's app before review when apps start in the background", async () => {
    const apps = new ScriptedAppHost("running", 20);
    const w = setup(apps, breaking(apps, 1), true);
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("merged");
    const backend = w.coder.turns.filter((t) => t.role === "backend");
    expect(backend).toHaveLength(2);
    expect(backend[1]?.prompt).toContain('Could not resolve "../page.ts"');
    const order = w.bus.log.flatMap((e) => (e.type === "agent.started" && (e.role === "backend" || e.role === "reviewer") ? [e.role] : []));
    expect(order.slice(0, 3)).toEqual(["backend", "backend", "reviewer"]);
  });

  it("ends stuck with a clear reason when the app never starts and attempts run out", async () => {
    const apps = new ScriptedAppHost();
    const w = setup(apps, breaking(apps, Infinity));
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("stuck");
    expect(record.machine.reason).toMatch(/same failure repeated.*the app still does not start/);
    expect(record.machine.feedback).toContain('Could not resolve "../page.ts"');
    expect(w.bus.log.some((e) => e.type === "agent.started" && e.role === "reviewer")).toBe(false);
    expect(w.coder.turns.filter((t) => t.role === "backend").length).toBeLessThanOrEqual(5);
  });

  it("stops asking for the same app again when a turn changed nothing", async () => {
    const apps = new ScriptedAppHost();
    const base = scriptFromFixture(fixture("todo"));
    const w = setup(apps, async (input, attempt) => {
      if (input.role === "backend" && attempt === 1) apps.failures = 1;
      return base(input, attempt);
    });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state).toBe("stuck");
    expect(record.machine.reason).toMatch(/the app still does not start/);
    expect(new Set(apps.runs).size).toBe(apps.runs.length);
  });

  it("reviews a branch with no compose file without waiting for an app", async () => {
    const apps = new ScriptedAppHost("no-stack");
    const w = setup(apps, scriptFromFixture(fixture("todo")));
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(PROMPT);
    await w.orchestrator.run(sessionId as string);
    const states = w.bus.log.flatMap((e) => (e.type === "session.state" ? [e.reason] : []));
    expect(states).not.toContain("app_failed");
    expect(w.bus.log.some((e) => e.type === "review.verdict" && e.approve)).toBe(true);
    expect(w.bus.log.some((e) => e.type === "app.updated" && e.status === "no-stack")).toBe(true);
  });
});
