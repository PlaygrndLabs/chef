import { describe, expect, it } from "vitest";
import { containerAppName, EngineIdCache } from "../../src/cloudflare-ids.ts";

const grant = { accountId: "acc1", apiToken: "tok" };

describe("engine ids on Cloudflare", () => {
  it("reads the engine's Durable Object namespaces and container application", async () => {
    const calls: string[] = [];
    const cache = new EngineIdCache(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/workers/durable_objects/namespaces?per_page=1000"))
        return Response.json({
          result: [
            { id: "ns1", script: "chef-dev", class: "SessionAgent" },
            { id: "ns2", script: "chef-dev", class: "ProjectAgent" },
            { id: "ns3", script: "other", class: "SessionAgent" },
          ],
        });
      return Response.json({ result: [{ id: "app1", name: containerAppName("chef-dev") }] });
    });
    expect(await cache.ids(grant, "chef-dev", 0)).toEqual({ namespaces: { SessionAgent: "ns1", ProjectAgent: "ns2" }, containerApp: "app1" });
    await cache.ids(grant, "chef-dev", 1000);
    expect(calls).toHaveLength(2);
  });

  it("gives up quietly when the token cannot read them", async () => {
    const cache = new EngineIdCache(async () => new Response("forbidden", { status: 403 }));
    expect(await cache.ids(grant, "chef-dev", 0)).toEqual({ namespaces: {}, containerApp: null });
    expect(await new EngineIdCache().ids(null, "chef-dev")).toEqual({ namespaces: {}, containerApp: null });
  });
});
