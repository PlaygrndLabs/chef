import { describe, expect, it } from "vitest";
import { cloudflareView, dashboardLink, engineOf, type CloudflareFacts } from "../../src/index.ts";

const box = (name: string, running = false) => ({ name, objectId: `id-${name}`, running, exit: null });

const facts: CloudflareFacts = {
  accountId: "acc1",
  engine: "chef-dev",
  project: "fresh",
  projectWorker: "chef-dev-fresh",
  projectObject: "id-fresh",
  namespaces: { SessionAgent: "ns-session", ProjectAgent: "ns-project" },
  containerApp: { name: "chef-dev-sessionagent", id: "app1" },
  main: { remote: "https://acc1.artifacts.cloudflare.net/git/chef-dev/fresh.git", commitId: "aaaaaaaaaaaaaaaa" },
  session: {
    id: "s-1",
    fork: "fresh--s-1",
    remote: "https://acc1.artifacts.cloudflare.net/git/chef-dev/fresh--s-1.git",
    removed: null,
    head: "bbbbbbbbbbbbbbbb",
    lanes: [{ role: "frontend", branch: "lane/frontend", head: "cccccccccccccccc" }],
  },
  sandboxes: { session: box("s-1", true), lanes: { frontend: box("s-1--frontend") }, preview: box("preview-todo") },
  preview: { name: "todo", branch: "preview/todo", url: "https://todo-chef-dev-fresh.acme.workers.dev", versionId: "v1", commitId: "bbbbbbbbbbbbbbbb", awake: true },
  live: { url: "https://chef-dev-fresh.acme.workers.dev", commitId: "aaaaaaaaaaaaaaaa", status: "ready" },
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
    expect(byKey["fork"]?.facts.find((f) => f.label === "Git remote")?.value).toBe(facts.session.remote);
    expect(byKey["sandbox"]?.state).toEqual({ tone: "run", text: "Running" });
    expect(byKey["sandbox"]?.facts.find((f) => f.label === "Application")?.value).toBe("chef-dev-sessionagent · app1");
    expect(byKey["sandbox:frontend"]).toMatchObject({ role: "frontend", state: { tone: "idle" } });
    expect(byKey["branch:frontend"]).toMatchObject({ role: "frontend", name: "lane/frontend" });
    expect(byKey["preview"]?.facts.find((f) => f.label === "Version")?.value).toBe("v1");
    expect(byKey["preview"]?.dashboard).toBe("https://dash.cloudflare.com/acc1/workers/services/view/chef-dev-fresh/production/deployments");
    expect(byKey["project-worker"]?.state?.text).toBe("Live");
    expect(byKey["workflow"]?.name).toBe("chef-dev-upstream-sync");
    expect(byKey["memory"]?.name).toBe("chef-dev-memory");
    expect(view.resources.filter((r) => r.group === "project").map((r) => r.key)).toEqual(["project-worker", "main", "engine", "project-object", "workflow", "memory"]);
  });

  it("says when the session repo is gone", () => {
    const view = cloudflareView({ ...facts, session: { ...facts.session, removed: "dropped", remote: null } });
    const fork = view.resources.find((r) => r.key === "fork");
    expect(fork?.state?.tone).toBe("gone");
    expect(fork?.facts.find((f) => f.label === "Archive")?.value).toBe("chef-dev/fresh archive/s-1");
  });

  it("never carries a token", () => {
    expect(JSON.stringify(cloudflareView(facts))).not.toMatch(/token|secret|Bearer/i);
  });
});
