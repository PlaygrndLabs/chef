import { describe, expect, it } from "vitest";
import { laneLayout } from "../../../template/app/gen.ts";
import type { ChefEvent } from "../../src/events/events.ts";
import { RuleReviewer, TemplatePlanner, type Script } from "../../src/fakes/index.ts";
import type { AppHost, AppRun } from "../../src/ports/app-host.ts";
import type { CoderTurnInput } from "../../src/ports/coder.ts";
import type { Plan, PlanInput } from "../../src/ports/planner.ts";
import type { ReviewInput, ReviewVerdict } from "../../src/ports/reviewer.ts";
import { fixture, scriptFromFixture, templateTree, todoSpec, world } from "../harness.ts";

const prompt = "Add an item to a todo list";
const todo = fixture("todo");
const PARTS = { backend: "features/todo-add/backend/routes.ts", frontend: "features/todo-add/frontend/routes.ts" };

class LanePlanner extends TemplatePlanner {
  constructor(private readonly roles: readonly string[]) {
    super(new Map([[prompt, todoSpec]]));
  }

  override async plan(input: PlanInput): Promise<Plan> {
    const plan = await super.plan(input);
    const items = plan.items.filter((i) => i.kind !== "code");
    const code = this.roles.map((role) => ({ id: `${plan.feature.id}-${role}`, featureId: plan.feature.id, kind: "code" as const, role, prompt: `Build the ${role} part of ${plan.feature.id}`, acceptance: plan.feature.acceptance.map((c) => c.id) }));
    return { ...plan, items: [...items, ...code] };
  }
}

const backendRoutes = (todo["features/todo-add/index.ts"] as string)
  .replace('import { json, type Feature } from "../../shared/http.ts";', 'import { json, type Route } from "../../../shared/http.ts";')
  .replace(/export const feature: Feature = \{\n {2}id: "todo-add",\n {2}title: "Add an item to a todo list",\n {2}routes: \[/, "export const routes: readonly Route[] = [")
  .replace(/\],\n\};\n$/, "];\n");

const frontendRoutes = ['import type { Route } from "../../../shared/http.ts";', "", 'export const routes: readonly Route[] = [{ method: "GET", path: "/todo", handle: () => new Response("<h1>Todo</h1>", { headers: { "content-type": "text/html" } }) }];', ""].join("\n");

function laneScript(extra: (input: CoderTurnInput, attempt: number) => Record<string, string> | null = () => null): { script: Script; inFlight: () => number } {
  const base = scriptFromFixture(todo);
  let running = 0;
  let peak = 0;
  let release: (() => void) | null = null;
  const together = new Promise<void>((resolve) => (release = resolve));
  const script: Script = async (input, attempt) => {
    if (input.role === "test") return base(input, attempt);
    const special = extra(input, attempt);
    if (special) return { changes: special };
    if (input.lane) {
      running++;
      peak = Math.max(peak, running);
      if (running >= 2) release?.();
      await Promise.race([together, new Promise((resolve) => setTimeout(resolve, 200))]);
      running--;
    }
    if (input.role === "backend") return { changes: { [PARTS.backend]: backendRoutes } };
    if (input.role === "frontend") return { changes: { [PARTS.frontend]: frontendRoutes } };
    return { changes: {} };
  };
  return { script, inFlight: () => peak };
}

function ofType<T extends ChefEvent["type"]>(log: readonly ChefEvent[], type: T): Extract<ChefEvent, { type: T }>[] {
  return log.filter((e): e is Extract<ChefEvent, { type: T }> => e.type === type);
}

describe("roles working in parallel inside one feature", () => {
  it("runs backend and frontend at the same time on their own branches and merges them into one session", async () => {
    const { script, inFlight } = laneScript();
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]) }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionIds } = await w.orchestrator.submit(prompt);
    expect(sessionIds).toHaveLength(1);
    const record = await w.orchestrator.run(sessionIds[0] as string);

    expect(record.machine.state).toBe("merged");
    expect(inFlight()).toBe(2);
    const turns = w.coder.turns.filter((t) => t.lane);
    expect(turns.map((t) => [t.role, t.lane, t.workspace.ref])).toEqual([
      ["backend", "backend", "lane/backend"],
      ["frontend", "frontend", "lane/frontend"],
    ]);
    expect(turns[0]?.workspace.commitId).toBe(turns[1]?.workspace.commitId);
    expect(turns[0]?.prompt).toContain("You are backend, on lane/backend");
    expect(turns[0]?.prompt).toContain("- frontend: Build the frontend part of todo-add");
    expect(turns[1]?.prompt).toContain(`Export your routes from ${PARTS.frontend}`);

    expect(ofType(w.bus.log, "lanes.started")[0]?.lanes).toEqual([
      { role: "backend", branch: "lane/backend", items: 1 },
      { role: "frontend", branch: "lane/frontend", items: 1 },
    ]);
    expect(ofType(w.bus.log, "lane.updated").map((e) => `${e.role}:${e.status}`)).toEqual(["backend:working", "frontend:working", "backend:committed", "frontend:committed", "backend:merged", "frontend:merged"]);
    expect(ofType(w.bus.log, "commit.created").filter((e) => e.lane).map((e) => e.lane)).toEqual(["backend", "frontend"]);

    const main = (await w.orchestrator.mainTree()).tree;
    expect(main[PARTS.backend]).toBe(backendRoutes);
    expect(main[PARTS.frontend]).toBe(frontendRoutes);
    expect(main["features/todo-add/index.ts"]).toContain("routes: [...backendRoutes, ...frontendRoutes]");
    expect(w.coder.released).toContain(record.id);
  });

  it("hands lines two roles both changed to the conflict fixer", async () => {
    const index = "features/todo-add/index.ts";
    const fixed = todo[index] as string;
    const { script } = laneScript((input) => {
      if (input.role === "conflict-resolver") return { [index]: fixed };
      if (input.role === "backend") return { [index]: fixed.replace("text is required", "text is missing") };
      if (input.role === "frontend") return { [index]: fixed.replace("text is required", "type something first") };
      return null;
    });
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]) } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(ofType(w.bus.log, "lane.updated").filter((e) => e.status === "conflict").map((e) => [e.role, e.paths])).toEqual([["frontend", [index]]]);
    const resolver = w.coder.turns.find((t) => t.role === "conflict-resolver");
    expect(resolver?.lane).toBeUndefined();
    expect(resolver?.prompt).toContain("The backend, frontend roles worked at the same time");
    expect((await w.orchestrator.mainTree()).tree[index]).toBe(fixed);
  });

  it("sends a blocked change back to its own role only", async () => {
    const { script } = laneScript((input, attempt) => (input.role === "frontend" && attempt === 1 ? { "src/index.ts": "export {};\n" } : null));
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]) }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    const backend = w.coder.turns.filter((t) => t.role === "backend");
    const frontend = w.coder.turns.filter((t) => t.role === "frontend");
    expect(backend).toHaveLength(1);
    expect(frontend).toHaveLength(2);
    expect(frontend[1]?.prompt).toContain("wrote outside your write scope");
    expect(ofType(w.bus.log, "turn.rejected").map((e) => [e.role, e.lane, e.rule])).toEqual([["frontend", "frontend", "write-scope"]]);
    expect(record.machine.usage.attempts).toBe(2);
  });

  it("sends the failing tests back to the test writer when no role changes anything after a failed gate", async () => {
    const { script } = laneScript((input, attempt) => (input.lane && attempt === 2 ? {} : null));
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]) }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    w.checks.failNext("test", "AC1 expected 201, got 200");
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    const retest = w.coder.turns.filter((t) => t.role === "test")[1];
    expect(retest?.prompt).toContain("AC1 expected 201, got 200");
    expect(retest?.prompt).toContain("- backend: backend turn 2");
    expect(retest?.prompt).toContain("- frontend: frontend turn 2");
  });

  it("asks every role to rework its part when the reviewer asks for changes", async () => {
    class OnceRejecting extends RuleReviewer {
      private rejected = false;
      override async review(input: ReviewInput): Promise<ReviewVerdict> {
        if (this.rejected) return super.review(input);
        this.rejected = true;
        return { approve: false, reasons: ["the page should say hello"], retest: false, model: this.model };
      }
    }
    const { script } = laneScript();
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]), reviewer: new OnceRejecting() }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    const rework = w.coder.turns.filter((t) => t.lane).slice(2);
    expect(rework.map((t) => t.role)).toEqual(["backend", "frontend"]);
    for (const turn of rework) expect(turn.prompt).toContain("the page should say hello");
    expect(ofType(w.bus.log, "lane.updated").filter((e) => e.status === "unchanged").map((e) => e.role)).toEqual(["backend", "frontend"]);
  });

  it("merges a role's finished work when another role's commit fails, and retries only the failed role", async () => {
    const { script } = laneScript();
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]) }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    const commit = w.repos.commit.bind(w.repos);
    let broken = true;
    w.repos.commit = async (token, input) => {
      if (broken && input.ref === "lane/frontend") {
        broken = false;
        throw new Error("the git server failed");
      }
      return commit(token, input);
    };
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const stuck = await w.orchestrator.run(sessionId as string);
    expect(stuck.machine.state).toBe("stuck");
    expect(stuck.machine.reason).toContain("the git server failed");
    expect(stuck.lanes?.map((l) => [l.role, l.done, l.unmerged ?? false])).toEqual([
      ["backend", 1, false],
      ["frontend", 0, false],
    ]);
    expect(ofType(w.bus.log, "lane.updated").map((e) => `${e.role}:${e.status}`)).toContain("backend:merged");

    await w.orchestrator.retry(sessionId as string, "");
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state, record.machine.reason).toBe("merged");
    expect(w.coder.turns.filter((t) => t.role === "backend")).toHaveLength(1);
    expect(w.coder.turns.filter((t) => t.role === "frontend")).toHaveLength(2);
    const main = (await w.orchestrator.mainTree()).tree;
    expect(main[PARTS.backend]).toBe(backendRoutes);
    expect(main[PARTS.frontend]).toBe(frontendRoutes);
  });

  it("reruns only the role whose sandbox dropped its clone", async () => {
    let dropped = false;
    const { script } = laneScript((input) => {
      if (input.role === "frontend" && !dropped) {
        dropped = true;
        throw new Error("coder runner failed with exit code 1: git clone failed: fatal: the remote end hung up unexpectedly");
      }
      return null;
    });
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]) }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state, record.machine.reason).toBe("merged");
    expect(w.coder.turns.filter((t) => t.lane).map((t) => t.role)).toEqual(["backend", "frontend", "frontend"]);
    const main = (await w.orchestrator.mainTree()).tree;
    expect(main[PARTS.backend]).toBe(backendRoutes);
    expect(main[PARTS.frontend]).toBe(frontendRoutes);
  });

  it("merges a committed role branch on retry when merging it failed", async () => {
    const { script } = laneScript();
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]) }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    const merge = w.repos.merge.bind(w.repos);
    let broken = true;
    w.repos.merge = async (token, input) => {
      if (broken && input.from.ref === "lane/frontend") {
        broken = false;
        throw new Error("the git server failed");
      }
      return merge(token, input);
    };
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const stuck = await w.orchestrator.run(sessionId as string);
    expect(stuck.machine.state).toBe("stuck");
    expect(stuck.lanes?.map((l) => [l.role, l.done, l.unmerged ?? false])).toEqual([
      ["backend", 1, false],
      ["frontend", 1, true],
    ]);

    await w.orchestrator.retry(sessionId as string, "");
    const record = await w.orchestrator.run(sessionId as string);
    expect(record.machine.state, record.machine.reason).toBe("merged");
    expect(w.coder.turns.filter((t) => t.lane).map((t) => t.role)).toEqual(["backend", "frontend"]);
    expect((await w.orchestrator.mainTree()).tree[PARTS.frontend]).toBe(frontendRoutes);
  });

  it("discards a role's change to a file another role owns", async () => {
    const { script } = laneScript((input, attempt) => (input.role === "frontend" && attempt === 1 ? { [PARTS.frontend]: frontendRoutes, [PARTS.backend]: backendRoutes.replace("text is required", "type something") } : null));
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]) }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state, record.machine.reason).toBe("merged");
    expect(ofType(w.bus.log, "turn.rejected").map((e) => [e.role, e.rule, e.paths])).toEqual([["frontend", "lane-owner", [PARTS.backend]]]);
    const frontend = w.coder.turns.filter((t) => t.role === "frontend");
    expect(frontend[1]?.prompt).toContain(`${PARTS.backend} belongs to backend`);
    expect(frontend[1]?.prompt).toContain(`- backend: ${PARTS.backend}`);
    expect((await w.orchestrator.mainTree()).tree[PARTS.backend]).toBe(backendRoutes);
  });

  it("sends review feedback only to the roles whose files it names", async () => {
    class NamesFrontend extends RuleReviewer {
      private rejected = false;
      override async review(input: ReviewInput): Promise<ReviewVerdict> {
        if (this.rejected) return super.review(input);
        this.rejected = true;
        return { approve: false, reasons: ["frontend/routes.ts should say hello"], retest: false, model: this.model };
      }
    }
    const { script } = laneScript();
    const w = world({ script, deps: { planner: new LanePlanner(["backend", "frontend"]), reviewer: new NamesFrontend() }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state, record.machine.reason).toBe("merged");
    const rework = w.coder.turns.filter((t) => t.lane).slice(2);
    expect(rework.map((t) => t.role)).toEqual(["frontend"]);
    expect(rework[0]?.prompt).toContain("Fix only the points about your own files");
  });

  it("sends an app that fails to build after the merge back to the role whose file broke it", async () => {
    let failures = 0;
    const apps: AppHost = {
      async run(input): Promise<AppRun> {
        if (failures-- > 0) return { status: "failed", url: null, local: null, commitId: input.commitId, error: `the app did not start: app logged an error: Could not resolve "./missing.ts" in ${PARTS.backend}:3` };
        return { status: "running", url: null, local: `http://${input.target}.local.example`, commitId: input.commitId };
      },
    };
    const { script } = laneScript((input, attempt) => {
      if (input.role !== "backend") return null;
      if (attempt === 1) failures = 1;
      return { [PARTS.backend]: `${backendRoutes}${"\n".repeat(attempt - 1)}` };
    });
    const w = world({ script, deps: { apps, planner: new LanePlanner(["backend", "frontend"]) }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state, record.machine.reason).toBe("merged");
    const rework = w.coder.turns.filter((t) => t.lane).slice(2);
    expect(rework.map((t) => t.role)).toEqual(["backend"]);
    expect(rework[0]?.prompt).toContain('Could not resolve "./missing.ts"');
    expect(ofType(w.bus.log, "lane.updated").filter((e) => e.status === "unchanged")).toEqual([]);
    expect(ofType(w.bus.log, "review.verdict")).toHaveLength(1);
  });

  it("keeps one role's steps in order on one branch", async () => {
    const w = world({ script: scriptFromFixture(todo), deps: { planner: new LanePlanner(["backend"]) } });
    await w.orchestrator.bootstrap(templateTree());
    const { sessionId } = await w.orchestrator.submit(prompt);
    const record = await w.orchestrator.run(sessionId as string);

    expect(record.machine.state).toBe("merged");
    expect(record.lanes ?? null).toBeNull();
    expect(w.coder.turns.filter((t) => t.role === "backend").map((t) => t.workspace.ref)).toEqual(["main"]);
    expect(ofType(w.bus.log, "lanes.started")).toEqual([]);
  });
});
