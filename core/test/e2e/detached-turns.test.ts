import { describe, expect, it } from "vitest";
import { laneLayout } from "../../../template/app/gen.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { TemplatePlanner, TickingClock, type Script } from "../../src/fakes/index.ts";
import { TurnRunning, type Coder, type CoderTurnInput, type CoderTurnResult, type ResumeTurnInput } from "../../src/ports/coder.ts";
import type { Plan, PlanInput } from "../../src/ports/planner.ts";
import { fixture, generated, profiles, scriptFromFixture, templateTree, todoSpec, world, type World } from "../harness.ts";

const PROMPT = "Add an item to a todo list";

interface Turn {
  readonly input: CoderTurnInput;
  polls: number;
  lost: boolean;
  result: CoderTurnResult | null;
}

class DetachedCoder implements Coder {
  readonly launched: CoderTurnInput[] = [];
  readonly turns = new Map<string, Turn>();
  readonly released: string[] = [];

  constructor(
    private readonly script: Script,
    private readonly polls: number,
    private readonly lose: (input: CoderTurnInput) => boolean = () => false,
  ) {}

  async runTurn(input: CoderTurnInput): Promise<CoderTurnResult> {
    if (!input.turnId) throw new Error("a detached coder needs a turn id");
    this.launched.push(input);
    input.onEvent({ type: "tool.execution_start", tool: "view", detail: input.workspace.repo });
    const turn: Turn = { input, polls: 0, lost: this.lose(input), result: null };
    this.turns.set(input.turnId, turn);
    return (await this.follow(turn)) ?? Promise.reject(new Error("the sandbox container stopped while the coder was working"));
  }

  async resumeTurn(input: ResumeTurnInput): Promise<CoderTurnResult | null> {
    const turn = this.turns.get(input.turnId);
    if (!turn || turn.lost) return null;
    return this.follow(turn);
  }

  async release(sessionId: string): Promise<void> {
    this.released.push(sessionId);
  }

  private async follow(turn: Turn): Promise<CoderTurnResult | null> {
    if (turn.lost) throw new TurnRunning(turn.input.turnId as string);
    if (turn.polls++ < this.polls) throw new TurnRunning(turn.input.turnId as string);
    if (!turn.result) {
      const { changes, summary } = await this.script(turn.input, 1);
      turn.input.onEvent({ type: "session.idle" });
      turn.result = { changes, summary: summary ?? `${turn.input.role} turn`, model: turn.input.model, runId: turn.input.turnId as string, usage: { inputTokens: 10, outputTokens: 10 } };
    }
    return turn.result;
  }
}

function detachedWorld(coder: DetachedCoder, clock = new TickingClock()): World {
  return world({ script: scriptFromFixture(fixture("todo")), presets: new Map([[PROMPT, todoSpec]]), deps: { coder, clock } });
}

async function submit(w: World): Promise<string> {
  await w.orchestrator.bootstrap(templateTree());
  return (await w.orchestrator.submit(PROMPT)).sessionId as string;
}

function started(w: World): string[] {
  return w.bus.log.flatMap((e) => (e.type === "agent.started" ? [e.role] : []));
}

describe("coder turns that outlive the step that started them", () => {
  it("keeps following a turn across steps and starts it only once", async () => {
    const coder = new DetachedCoder(scriptFromFixture(fixture("todo")), 3);
    const w = detachedWorld(coder);
    const record = await w.orchestrator.run(await submit(w), 200);

    expect(record.machine.state).toBe("merged");
    expect(coder.launched.map((t) => t.role)).toEqual(["test", "backend"]);
    expect(started(w)).toEqual(["planner", "test", "backend", "reviewer"]);
    expect(record.turns ?? null).toBeNull();
  });

  it("picks up the running turn after the engine restarts instead of starting it again", async () => {
    const coder = new DetachedCoder(scriptFromFixture(fixture("todo")), 2);
    const w = detachedWorld(coder);
    const id = await submit(w);
    while (!(await w.orchestrator.session(id)).turns) await w.orchestrator.step(id);
    const held = (await w.orchestrator.session(id)).turns?.["main"];
    expect(held).toMatchObject({ item: expect.any(String), restarts: 0 });

    const restarted = new Orchestrator(w.deps, { name: "demo", author: { name: "chef", email: "ma.karimi76@gmail.com" }, profiles: profiles(), generated });
    const record = await restarted.run(id, 200);

    expect(record.machine.state).toBe("merged");
    expect(coder.launched.map((t) => t.role)).toEqual(["test", "backend"]);
    expect(coder.launched[0]?.turnId).toBe(held?.id);
  });

  it("finishes the turn from its saved result when the step died after committing it", async () => {
    const coder = new DetachedCoder(scriptFromFixture(fixture("todo")), 0);
    const w = detachedWorld(coder);
    const id = await submit(w);
    while ((await w.orchestrator.session(id)).machine.state !== "testing") await w.orchestrator.step(id);
    const before = structuredClone(await w.orchestrator.session(id));
    await w.orchestrator.step(id);
    const turn = coder.launched[0]?.turnId as string;
    await w.deps.store.put(`session/${id}`, { ...before, turns: { main: { id: turn, item: `${todoSpec.id}-2`, startedAt: before.updatedAt, restarts: 0 } } });

    const record = await w.orchestrator.run(id, 200);
    expect(record.machine.state).toBe("merged");
    expect(coder.launched.map((t) => t.role)).toEqual(["test", "backend"]);
  });

  it("starts a turn again and says so when its sandbox stopped", async () => {
    let losses = 1;
    const coder = new DetachedCoder(scriptFromFixture(fixture("todo")), 1, (input) => input.role === "backend" && losses-- > 0);
    const w = detachedWorld(coder);
    const record = await w.orchestrator.run(await submit(w), 200);

    expect(record.machine.state).toBe("merged");
    expect(coder.launched.map((t) => t.role)).toEqual(["test", "backend", "backend"]);
    const notices = w.bus.log.flatMap((e) => (e.type === "coder.event" && e.event.type === "session.error" ? [e.event.message] : []));
    expect(notices).toEqual(["The sandbox stopped while this turn was running, so the turn starts again."]);
  });

  it("stops with a reason when the sandbox keeps stopping", async () => {
    const coder = new DetachedCoder(scriptFromFixture(fixture("todo")), 1, (input) => input.role === "backend");
    const w = detachedWorld(coder);
    const record = await w.orchestrator.run(await submit(w), 200);

    expect(record.machine).toMatchObject({ state: "stuck", reason: expect.stringContaining("the sandbox stopped 3 times") });
    expect(coder.launched.filter((t) => t.role === "backend")).toHaveLength(3);
  });

  it("stops with a reason when a turn never finishes", async () => {
    const clock = new TickingClock(Date.UTC(2026, 9, 11, 12, 0, 0), 60_000);
    const coder = new DetachedCoder(scriptFromFixture(fixture("todo")), Infinity);
    const w = detachedWorld(coder, clock);
    const record = await w.orchestrator.run(await submit(w), 400);

    expect(record.machine).toMatchObject({ state: "stuck", reason: expect.stringContaining("ran for over 90 minutes") });
    expect(coder.launched).toHaveLength(1);
  });
});

class LanePlanner extends TemplatePlanner {
  constructor() {
    super(new Map([[PROMPT, todoSpec]]));
  }

  override async plan(input: PlanInput): Promise<Plan> {
    const plan = await super.plan(input);
    const items = plan.items.filter((i) => i.kind !== "code");
    const code = ["backend", "frontend"].map((role) => ({ id: `${plan.feature.id}-${role}`, featureId: plan.feature.id, kind: "code" as const, role, prompt: `Build the ${role} part of ${plan.feature.id}`, acceptance: plan.feature.acceptance.map((c) => c.id) }));
    return { ...plan, items: [...items, ...code] };
  }
}

describe("lanes with turns that outlive a step", () => {
  it("follows each lane's own turn until both finish", async () => {
    const todo = fixture("todo");
    const base = scriptFromFixture(todo);
    const parts: Record<string, string> = { backend: "features/todo-add/backend/notes.ts", frontend: "features/todo-add/frontend/notes.ts" };
    const script: Script = (input, attempt) => (input.lane ? { changes: { [parts[input.lane] as string]: `export const part = "${input.lane}";\n` } } : base(input, attempt));
    const coder = new DetachedCoder(script, 2);
    const w = world({ script, presets: new Map([[PROMPT, todoSpec]]), deps: { coder, planner: new LanePlanner() }, config: { specialization: { laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) } } });
    const id = await submit(w);
    for (let i = 0; i < 200; i++) {
      const record = await w.orchestrator.session(id);
      if (record.lanes?.every((lane) => lane.done >= lane.items.length)) break;
      await w.orchestrator.step(id);
    }

    expect(coder.launched.filter((t) => t.lane).map((t) => t.lane)).toEqual(["backend", "frontend"]);
    expect((await w.orchestrator.session(id)).turns ?? null).toBeNull();
  });
});
