export const ACCOUNT = "0123456789abcdef0123456789abcdef";
export const E = "chef-acme-x7k2";
export const F = "chef-acme-x7k2-ab12";
export const image = (ref: string) => `registry.cloudflare.com/${ACCOUNT}/${ref}`;

export interface Account {
  scripts: { id: string; tags?: string[] }[];
  workers: { id: string; name: string; tags?: string[] }[];
  namespaces: { id: string; script: string; class: string }[];
  workflows: { name: string; script_name: string }[];
  containers: { id: string; name: string; durable_objects?: { namespace_id: string }; configuration: { image: string } }[];
  indexes: { name: string }[];
  repos: Record<string, string[]>;
  tokens: { id: string; name: string }[];
  tags: Record<string, string[]>;
}

export function account(withF = true): Account {
  return {
    scripts: [
      { id: "chef-dev" },
      { id: E },
      { id: `${E}-shop`, tags: ["chef-project"] },
      { id: `${E}-notchef` },
      { id: "websims" },
      { id: "sub2api" },
      ...(withF ? [{ id: F }, { id: `${F}-shop`, tags: ["chef-project"] }] : []),
    ],
    workers: [
      { id: "w-shop", name: `${E}-shop`, tags: ["chef-project"] },
      { id: "w-blog", name: `${E}-blog`, tags: ["chef-project"] },
      { id: "w-dev-app", name: "chef-dev-todo", tags: ["chef-project"] },
    ],
    namespaces: [
      { id: "ns-e-p", script: E, class: "ProjectAgent" },
      { id: "ns-e-s", script: E, class: "SessionAgent" },
      { id: "ns-shop", script: `${E}-shop`, class: "StoreObject" },
      { id: "ns-dev-p", script: "chef-dev", class: "ProjectAgent" },
      { id: "ns-dev-s", script: "chef-dev", class: "SessionAgent" },
      ...(withF ? [{ id: "ns-f-p", script: F, class: "ProjectAgent" }, { id: "ns-f-s", script: F, class: "SessionAgent" }] : []),
    ],
    workflows: [
      { name: `${E}-upstream-sync`, script_name: E },
      { name: "chef-dev-upstream-sync", script_name: "chef-dev" },
      ...(withF ? [{ name: `${F}-upstream-sync`, script_name: F }] : []),
    ],
    containers: [
      { id: "c-e", name: `${E}-sessionagent`, durable_objects: { namespace_id: "ns-e-s" }, configuration: { image: image("chef-sandbox:v2") } },
      { id: "c-dev", name: "chef-dev-sessionagent", durable_objects: { namespace_id: "ns-dev-s" }, configuration: { image: image("chef-dev-sessionagent:abc") } },
      ...(withF ? [{ id: "c-f", name: `${F}-sessionagent`, durable_objects: { namespace_id: "ns-f-s" }, configuration: { image: image("chef-sandbox:v1") } }] : []),
    ],
    indexes: [{ name: `${E}-memory` }, { name: "chef-dev-memory" }, { name: "notes" }, ...(withF ? [{ name: `${F}-memory` }] : [])],
    repos: { [E]: ["shop", "blog"], "chef-dev": ["todo"], ...(withF ? { [F]: ["shop"] } : {}) },
    tokens: [{ id: "t-e", name: `chef previews (${E})` }, { id: "t-dev", name: "chef previews (chef-dev)" }, { id: "t-mine", name: "my token" }, ...(withF ? [{ id: "t-f", name: `chef previews (${F})` }] : [])],
    tags: { "chef-sandbox": ["v0", "v1", "v2"], "chef-dev-sessionagent": ["abc"] },
  };
}

export function cloudflare(state: Account) {
  const deleted: string[] = [];
  const ok = (result: unknown) => Response.json({ success: true, result });
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.host === "registry.cloudflare.com") {
      const tags = /^\/v2\/[0-9a-f]+\/(.+)\/tags\/list$/.exec(url.pathname);
      if (tags) return Response.json({ tags: state.tags[tags[1] as string] ?? [] });
      const manifest = /^\/v2\/[0-9a-f]+\/(.+)\/manifests\/(.+)$/.exec(url.pathname);
      if (manifest && method === "DELETE") {
        deleted.push(`image ${manifest[1]}:${manifest[2]}`);
        state.tags[manifest[1] as string] = (state.tags[manifest[1] as string] ?? []).filter((t) => t !== manifest[2]);
        return new Response(null, { status: 202 });
      }
      return new Response(null, { status: 200 });
    }
    const path = url.pathname.replace(`/client/v4/accounts/${ACCOUNT}`, "");
    if (method === "GET") {
      if (path === "/workers/scripts") return ok(state.scripts);
      if (path === "/workers/workers") return ok(state.workers);
      if (path === "/workers/durable_objects/namespaces") return ok(state.namespaces);
      if (path === "/workflows") return ok(state.workflows);
      if (path === "/containers/applications") return ok(state.containers);
      if (path === "/vectorize/v2/indexes") return ok(state.indexes);
      if (path === "/tokens") return ok(state.tokens);
      const repos = /^\/artifacts\/namespaces\/([^/]+)\/repos$/.exec(path);
      if (repos) return state.repos[decodeURIComponent(repos[1] as string)] ? ok(state.repos[decodeURIComponent(repos[1] as string)]?.map((name) => ({ name }))) : Response.json({ success: false, errors: [{ message: "not found" }] }, { status: 404 });
    }
    if (method === "POST" && path === "/containers/registries/registry.cloudflare.com/credentials") return ok({ username: "v1", password: "pw" });
    if (method === "DELETE") {
      deleted.push(`${path}${url.search}`);
      const name = decodeURIComponent(path.split("/").pop()?.split("?")[0] ?? "");
      if (path.startsWith("/workers/scripts/")) {
        state.scripts = state.scripts.filter((s) => s.id !== name);
        state.namespaces = state.namespaces.filter((n) => n.script !== name);
        state.workers = state.workers.filter((w) => w.name !== name);
      }
      if (path.startsWith("/workers/workers/")) state.workers = state.workers.filter((w) => w.id !== name);
      if (path.startsWith("/workflows/")) state.workflows = state.workflows.filter((w) => w.name !== name);
      if (path.startsWith("/containers/applications/")) state.containers = state.containers.filter((c) => c.id !== name);
      if (path.startsWith("/vectorize/v2/indexes/")) state.indexes = state.indexes.filter((i) => i.name !== name);
      if (path.startsWith("/tokens/")) state.tokens = state.tokens.filter((t) => t.id !== name);
      const repo = /^\/artifacts\/namespaces\/([^/]+)\/repos\/([^/]+)$/.exec(path);
      if (repo) state.repos[decodeURIComponent(repo[1] as string)] = (state.repos[decodeURIComponent(repo[1] as string)] ?? []).filter((r) => r !== decodeURIComponent(repo[2] as string));
      return ok(null);
    }
    return Response.json({ success: false, errors: [{ message: `unexpected ${method} ${path}` }] }, { status: 404 });
  };
  return { fetcher, deleted };
}

