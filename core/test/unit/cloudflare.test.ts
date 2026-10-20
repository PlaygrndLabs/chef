import { describe, expect, it } from "vitest";
import { addCost, agentsOf, cloudflareView, lifetime, NO_COST, sandboxMicros, dashboardLink, engineOf, type CloudflareFacts } from "../../src/index.ts";

const box = (name: string, running = false) => ({ name, objectId: `id-${name}`, running, exit: null });

const session = {
  id: "s-1",
  fork: "fresh--s-1",
  remote: "https://acc1.artifacts.cloudflare.net/git/chef-dev/fresh--s-1.git",
  removed: null,
  head: "bbbbbbbbbbbbbbbb",
  lanes: [{ role: "frontend", branch: "lane/frontend", head: "cccccccccccccccc" }],
} as const;

const facts: CloudflareFacts = {
  accountId: "acc1",
  engine: "chef-dev",
  project: "fresh",
  router: "chef-dev-app",
  projectObject: "id-fresh",
  namespaces: { SessionAgent: "ns-session", ProjectAgent: "ns-project" },
  containerApp: { name: "chef-dev-sessionagent", id: "app1" },
  main: { remote: "https://acc1.artifacts.cloudflare.net/git/chef-dev/fresh.git", commitId: "aaaaaaaaaaaaaaaa" },
  session,
  agents: { sandbox: ["test"], engine: ["planner", "reviewer"] },
  sandboxes: { session: box("s-1", true), main: box("fresh--main") },
  app: { name: "s-1-fresh", url: "https://s-1-fresh-chef-dev-app.acme.workers.dev", status: "running", commitId: "bbbbbbbbbbbbbbbb" },
  mainApp: { url: "https://main-fresh-chef-dev-app.acme.workers.dev", commitId: "aaaaaaaaaaaaaaaa", status: "starting" },
};

describe("Cloudflare view of a session", () => {
  it("names the engine after the project Worker prefix", () => {
    expect(engineOf("chef-dev-")).toBe("chef-dev");
    expect(engineOf("")).toBe("chef");
  });

  it("links the dashboard of the engine's own account", () => {
    expect(dashboardLink("acc1", "workers/containers")).toBe("https://dash.cloudflare.com/acc1/workers/containers");
    expect(dashboardLink(null, "workers/containers")).toBe("https://dash.cloudflare.com/?to=/:account/workers/containers");
  });

  it("lists every resource the build uses with its real names and state", () => {
    const view = cloudflareView(facts);
    const byKey = Object.fromEntries(view.resources.map((r) => [r.key, r]));
    expect(byKey["fork"]?.name).toBe("chef-dev/fresh--s-1");
    expect(byKey["fork"]?.facts.find((f) => f.label === "Git remote")?.value).toBe(session.remote);
    expect(byKey["sandbox"]?.state).toEqual({ tone: "run", text: "Running" });
    expect(byKey["sandbox"]?.facts.find((f) => f.label === "Application")?.value).toBe("chef-dev-sessionagent · app1");
    expect(byKey["sandbox"]?.roles).toEqual(["test", "frontend"]);
    expect(byKey["sandbox:frontend"]).toBeUndefined();
    expect(byKey["branch:frontend"]).toMatchObject({ roles: ["frontend"], name: "lane/frontend" });
    expect(byKey["app"]?.facts.find((f) => f.label === "URL")?.value).toBe("https://s-1-fresh-chef-dev-app.acme.workers.dev");
    expect(byKey["app"]?.state).toEqual({ tone: "ok", text: "Running" });
    expect(byKey["app"]?.dashboard).toBe("https://dash.cloudflare.com/acc1/workers/services/view/chef-dev-app/production/deployments");
    expect(byKey["main-app"]?.state?.text).toBe("Starting");
    expect(byKey["workflow"]?.name).toBe("chef-dev-upstream-sync");
    expect(byKey["memory"]?.name).toBe("chef-dev-memory");
    expect(view.resources.filter((r) => r.group === "project").map((r) => r.key)).toEqual(["sandbox:main", "main-app", "router", "main", "engine", "project-object", "workflow", "memory"]);
  });

  it("calls an app asleep when its sandbox sleeps, since a visit wakes it", () => {
    const asleep = cloudflareView({ ...facts, sandboxes: { session: box("s-1"), main: box("fresh--main") }, mainApp: { url: "https://main-fresh-chef-dev-app.acme.workers.dev", commitId: "aaaaaaaaaaaaaaaa", status: "running" } });
    const byKey = Object.fromEntries(asleep.resources.map((r) => [r.key, r]));
    expect(byKey["sandbox"]?.state).toEqual({ tone: "idle", text: "Sleeping" });
    expect(byKey["app"]?.state).toEqual({ tone: "idle", text: "Asleep, wakes on a visit" });
    expect(byKey["main-app"]?.state).toEqual({ tone: "idle", text: "Asleep, wakes on a visit" });
  });

  it("says which agents use each resource", () => {
    const view = cloudflareView(facts);
    const usedBy = (role: string) => view.resources.filter((r) => r.roles.includes(role)).map((r) => r.key);
    expect(usedBy("frontend")).toEqual(["fork", "branch:frontend", "sandbox", "memory"]);
    expect(usedBy("test")).toEqual(["fork", "sandbox", "memory"]);
    expect(usedBy("planner")).toEqual(["main", "engine", "project-object"]);
    expect(usedBy("reviewer")).toEqual(["fork", "engine", "project-object"]);
  });

  it("finds which roles work in the session sandbox and which in their own lane", () => {
    const items = [
      { id: "i1", role: "test" },
      { id: "i2", role: "frontend" },
      { id: "i3", role: "backend" },
    ];
    expect(agentsOf({ plan: { items }, lanes: [{ items: ["i2"] }, { items: ["i3"] }] })).toEqual({ sandbox: ["test"], engine: ["planner", "reviewer"] });
    expect(agentsOf({ kind: "chore", plan: { items: [{ id: "c1", role: "chore" }] } })).toEqual({ sandbox: ["chore"], engine: ["reviewer"] });
  });

  it("says when the session repo is gone", () => {
    const view = cloudflareView({ ...facts, session: { ...session, removed: "dropped", remote: null } });
    const fork = view.resources.find((r) => r.key === "fork");
    expect(fork?.state?.tone).toBe("gone");
    expect(fork?.facts.find((f) => f.label === "Archive")?.value).toBe("chef-dev/fresh archive/s-1");
  });

  it("lists only the project's own resources when no build is asked for", () => {
    const view = cloudflareView({ ...facts, session: null, sandboxes: { session: null, main: box("fresh--main") }, app: null });
    expect(view.resources.every((r) => r.group === "project")).toBe(true);
    expect(view.resources.map((r) => r.key)).toContain("sandbox:main");
  });

  it("carries what a sandbox cost so far", () => {
    const view = cloudflareView({ ...facts, sandboxes: { session: { ...box("s-1"), spent: { micros: 54_000, seconds: 3600 } }, main: null } });
    expect(view.resources.find((r) => r.key === "sandbox")?.spent).toEqual({ micros: 54_000, seconds: 3600 });
  });

  it("never carries a token", () => {
    expect(JSON.stringify(cloudflareView(facts))).not.toMatch(/token|secret|Bearer/i);
  });
});

describe("Cloudflare cost of a sandbox", () => {
  it("prices memory and disk for every second it is up and CPU only when busy", () => {
    expect(sandboxMicros({ memoryMib: 6144, diskMb: 12_000, seconds: 3600, cpuSeconds: 0 })).toBeCloseTo(6 * 3600 * 2.5 + 12 * 3600 * 0.07);
    expect(sandboxMicros({ memoryMib: 3072, diskMb: 12_000, seconds: 0, cpuSeconds: 10 })).toBe(200);
    expect(sandboxMicros({ memoryMib: 3072, diskMb: 12_000, seconds: -5, cpuSeconds: -1 })).toBe(0);
  });

  it("adds each part's spend to a build's cost by month, and sums its lifetime", () => {
    const cost = addCost(addCost(addCost(NO_COST, "2026-10", "model", 300), "2026-10", "sandbox", 100, 60), "2026-11", "router", 5);
    expect(cost).toEqual({ months: { "2026-10": { model: 300, sandbox: 100 }, "2026-11": { router: 5 } }, sandboxSeconds: 60 });
    expect(lifetime(cost)).toEqual({ model: 300, sandbox: 100, router: 5 });
  });
});
