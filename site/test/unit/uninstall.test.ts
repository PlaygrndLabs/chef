import { describe, expect, it } from "vitest";
import { ownsApp, readImage, StopRemoval, Uninstaller, type Removal } from "../../src/uninstall.ts";
import { account, ACCOUNT, cloudflare, E, F, image } from "../support/cloudflare.ts";

const job = (over: Partial<Removal> = {}): Removal => ({ accountId: ACCOUNT, engine: E, projects: ["shop", "blog"], ownAccount: false, ...over });
const noWait = async () => undefined;

describe("uninstalling chef from one organization", () => {
  it("removes exactly what this organization's chef made and nothing else on the account", async () => {
    const state = account();
    const { fetcher, deleted } = cloudflare(state);
    const tool = new Uninstaller("tok", job(), fetcher as typeof fetch);
    const found = await tool.find();
    expect(found.engine).toEqual({ name: E, id: null, script: true });
    expect(found.apps.map((a) => a.name)).toEqual([`${E}-blog`, `${E}-shop`]);
    expect(found.workflows).toEqual([`${E}-upstream-sync`]);
    expect(found.containers).toEqual([{ id: "c-e", name: `${E}-sessionagent` }]);
    expect(found.indexes).toEqual([`${E}-memory`]);
    expect(found.repos).toEqual(["shop", "blog"]);
    expect(found.tokens).toEqual([{ id: "t-e", name: `chef previews (${E})` }]);
    expect(found.images).toEqual([]);
    const lines: string[] = [];
    const outcome = await tool.remove(found, (line) => lines.push(line), async () => undefined, noWait);
    expect(outcome).toEqual({ failed: [], left: [] });
    expect(deleted.filter((d) => !d.startsWith("/triggers") && !d.startsWith(`/artifacts/namespaces/${E}`) || d.includes("/repos/"))).toEqual([
      `/workflows/${E}-upstream-sync`,
      `/workers/scripts/${E}?force=true`,
      "/containers/applications/c-e",
      "/workers/workers/w-blog",
      `/workers/scripts/${E}-shop?force=true`,
      "/workers/workers/w-shop",
      `/artifacts/namespaces/${E}/repos/shop`,
      `/artifacts/namespaces/${E}/repos/blog`,
      `/vectorize/v2/indexes/${E}-memory`,
      "/tokens/t-e",
    ]);
    expect(state.scripts.map((s) => s.id)).toEqual(["chef-dev", `${E}-notchef`, "websims", "sub2api", F, `${F}-shop`]);
    expect(state.workflows.map((w) => w.name)).toEqual(["chef-dev-upstream-sync", `${F}-upstream-sync`]);
    expect(state.indexes.map((i) => i.name)).toEqual(["chef-dev-memory", "notes", `${F}-memory`]);
    expect(state.tokens.map((t) => t.id)).toEqual(["t-dev", "t-mine", "t-f"]);
    expect(state.repos[F]).toEqual(["shop"]);
    expect(state.tags["chef-sandbox"]).toEqual(["v0", "v1", "v2"]);
    expect(lines).toContain(`removed chef's engine ${E}`);
  });

  it("clears every copy of the sandbox image when no other chef on the account uses it", async () => {
    const state = account(false);
    const { fetcher } = cloudflare(state);
    const tool = new Uninstaller("tok", job(), fetcher as typeof fetch);
    const found = await tool.find();
    expect(found.images.map((i) => i.ref).sort()).toEqual(["v0", "v1", "v2"]);
    expect((await tool.remove(found, () => undefined, async () => undefined, noWait)).failed).toEqual([]);
    expect(state.tags["chef-sandbox"]).toEqual([]);
    expect(state.tags["chef-dev-sessionagent"]).toEqual(["abc"]);
  });

  it("never removes the image chef copies to new accounts from its own account", async () => {
    const state = account(false);
    state.containers.push({ id: "c-e2", name: `${E}-other`, durable_objects: { namespace_id: "ns-e-p" }, configuration: { image: image(`${E}-sessionagent:abc@sha256:1`) } });
    state.tags[`${E}-sessionagent`] = ["abc", "old"];
    const { fetcher } = cloudflare(state);
    const found = await new Uninstaller("tok", job({ ownAccount: true }), fetcher as typeof fetch).find();
    expect(found.images).toEqual([{ repo: `${E}-sessionagent`, ref: "abc" }, { repo: `${E}-sessionagent`, ref: "old" }]);
  });

  it("leaves a sandbox image alone while another chef on the account uses it, whatever its tag", async () => {
    const state = account();
    (state.containers[2] as { configuration: { image: string } }).configuration.image = image("chef-sandbox@sha256:feed");
    const { fetcher } = cloudflare(state);
    expect((await new Uninstaller("tok", job(), fetcher as typeof fetch).find()).images).toEqual([]);
  });

  it("stops before touching anything when a Worker with the engine's name is not chef", async () => {
    const state = account(false);
    state.namespaces = state.namespaces.filter((n) => n.script !== E);
    const { fetcher, deleted } = cloudflare(state);
    await expect(new Uninstaller("tok", job(), fetcher as typeof fetch).find()).rejects.toBeInstanceOf(StopRemoval);
    expect(deleted).toEqual([]);
  });

  it("stops when Cloudflare will not show the account", async () => {
    const fetcher = async () => Response.json({ success: false, errors: [{ message: "Authentication error" }] }, { status: 403 });
    await expect(new Uninstaller("tok", job(), fetcher as typeof fetch).find()).rejects.toThrow(/did not let chef list the Workers/);
  });

  it("reports what it could not remove and keeps the organization for another try", async () => {
    const state = account(false);
    const { fetcher } = cloudflare(state);
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "DELETE" && String(input).includes("/vectorize/") ? Response.json({ success: false, errors: [{ message: "busy" }] }, { status: 500 }) : fetcher(input, init)) as typeof fetch;
    const tool = new Uninstaller("tok", job(), failing);
    const outcome = await tool.remove(await tool.find(), () => undefined, async () => undefined, noWait);
    expect(outcome.failed).toEqual([`the memory index ${E}-memory (busy)`]);
  });

  it("tells apart apps of engines whose names share a beginning", () => {
    const engines = new Set(["chef-a-abcd", "chef-a-abcd-wxyz"]);
    expect(ownsApp("chef-a-abcd-shop", "chef-a-abcd", engines, null)).toBe(true);
    expect(ownsApp("chef-a-abcd-wxyz-shop", "chef-a-abcd", engines, null)).toBe(false);
    expect(ownsApp("chef-a-abcd-wxyz", "chef-a-abcd", engines, null)).toBe(false);
    expect(ownsApp("chef-a-abcd-wxyz-shop", "chef-a-abcd-wxyz", engines, ["shop"])).toBe(true);
    expect(ownsApp("chef-a-abcd-wxyz-blog", "chef-a-abcd-wxyz", engines, ["shop"])).toBe(false);
    expect(ownsApp("chef-b-abcd-shop", "chef-a-abcd", engines, null)).toBe(false);
  });

  it("reads image references in the account's registry", () => {
    expect(readImage(image("chef-sandbox:v2@sha256:abc"), ACCOUNT)).toEqual({ repo: "chef-sandbox", ref: "v2" });
    expect(readImage(image("chef-sandbox@sha256:abc"), ACCOUNT)).toEqual({ repo: "chef-sandbox", ref: "sha256:abc" });
    expect(readImage("docker.io/library/node:22", ACCOUNT)).toBeNull();
  });
});
