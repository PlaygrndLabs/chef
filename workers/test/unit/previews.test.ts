import { describe, expect, it } from "vitest";
import { lostCreateRace, parsePreview, previewName } from "../../src/sandbox-checks.ts";
import { cloudflareAllowed } from "../../src/sandbox-grants.ts";

const grant = { accountId: "acc1", worker: "chef-project-demo" };
const api = (path: string) => new URL(`https://api.cloudflare.com/client/v4/accounts/acc1${path}`);

describe("sandbox previews", () => {
  it("names a preview after its feature branch", () => {
    expect(previewName("preview/add-todo-item")).toBe("add-todo-item");
    expect(previewName("preview/Add_Todo--s1")).toBe("add-todo-s1");
    expect(previewName("preview/a-very-long-feature-name-that-goes-on-and-on")).toBe("a-very-long-feature-name-that");
  });

  it("reads the Preview URL and deployment from wrangler preview --json", () => {
    const stdout = `noise\n${JSON.stringify({ preview: { name: "add-todo-item", urls: ["https://add-todo-item-chef-project-demo.acme.workers.dev"] }, deployment: { id: "dep1", urls: ["https://dep1-chef-project-demo.acme.workers.dev"] } }, null, 2)}\n`;
    expect(parsePreview(stdout, "c1")).toEqual({ url: "https://add-todo-item-chef-project-demo.acme.workers.dev", versionId: "dep1", commitId: "c1" });
    expect(() => parsePreview("Error: not authorized", "c1")).toThrow(/no JSON/);
    expect(() => parsePreview(JSON.stringify({ preview: {}, deployment: {} }), "c1")).toThrow(/no URL/);
  });

  it("spots a preview that lost the race to create the project Worker", () => {
    expect(lostCreateRace("✘ [ERROR] A request to the Cloudflare API (/accounts/a/workers/workers) failed.\n\n  A Worker with the name 'chef-project-todo5' already exists. Choose a different name. [code: 10040]")).toBe(true);
    expect(lostCreateRace("✘ [ERROR] Authentication error [code: 10000]")).toBe(false);
  });

  it("lends the Cloudflare token only to the project Worker's API paths", () => {
    expect(cloudflareAllowed(api("/workers/workers"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/subdomain"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/workers/chef-project-demo/previews/add-todo-item/deployments"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/scripts/chef-project-demo/subdomain"), grant)).toBe(true);
    expect(cloudflareAllowed(api("/workers/scripts/chef"), grant)).toBe(false);
    expect(cloudflareAllowed(api("/workers/workers/chef-project-demo-evil"), grant)).toBe(false);
    expect(cloudflareAllowed(api("/r2/buckets"), grant)).toBe(false);
    expect(cloudflareAllowed(new URL("https://api.cloudflare.com/client/v4/accounts/other/workers/workers"), grant)).toBe(false);
    expect(cloudflareAllowed(new URL("https://evil.example/client/v4/accounts/acc1/workers/workers"), grant)).toBe(false);
  });
});
