import { describe, expect, it } from "vitest";
import { ENGINE_PATH, proxy } from "../../src/proxy.ts";

const engine = { url: "https://chef.sam.workers.dev", secret: "engine-secret" };

describe("engine proxy", () => {
  it("only sends chef's API, live connections and previews to the engine", () => {
    for (const path of ["/api/projects", "/api", "/agents/project-agent/todo", "/preview/todo/home"]) expect(ENGINE_PATH.test(path)).toBe(true);
    for (const path of ["/", "/setup", "/assets/app.js", "/apiary", "/site/api/me"]) expect(ENGINE_PATH.test(path)).toBe(false);
  });

  it("signs requests with the engine secret, never forwards the site's cookies and tells the engine its public address", async () => {
    let seen: Request | null = null;
    const response = await proxy(
      new Request("https://chef.example.com/api/projects?x=1", { method: "POST", body: "{}", headers: { cookie: "chef_session=s", authorization: "Bearer stolen", "x-chef-origin": "https://evil.example", "content-type": "application/json" } }),
      engine,
      "https://chef.example.com",
      async (input, init) => {
        seen = new Request(input, init);
        return new Response("ok", { status: 201, headers: { "set-cookie": "chef=1", location: "https://chef.sam.workers.dev/?project=todo" } });
      },
    );
    const request = seen as unknown as Request;
    expect(request.url).toBe("https://chef.sam.workers.dev/api/projects?x=1");
    expect(request.headers.get("authorization")).toBe("Bearer engine-secret");
    expect(request.headers.get("cookie")).toBeNull();
    expect(request.headers.get("x-chef-origin")).toBe("https://chef.example.com");
    expect(await request.text()).toBe("{}");
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBe("/?project=todo");
  });

  it("says so when the engine cannot be reached", async () => {
    const response = await proxy(new Request("https://chef.example.com/api/projects"), engine, "https://chef.example.com", async () => {
      throw new Error("down");
    });
    expect(response.status).toBe(502);
  });
});
