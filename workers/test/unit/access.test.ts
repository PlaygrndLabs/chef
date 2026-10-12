import { describe, expect, it } from "vitest";
import { guard } from "../../src/access.ts";

const at = (path: string, init?: RequestInit) => new Request(`https://kargah.example${path}`, init);

describe("dashboard access", () => {
  it("refuses everything while no password is set", async () => {
    expect((await guard(at("/"), undefined))?.status).toBe(503);
    expect((await guard(at("/api/projects/demo/sessions"), undefined))?.status).toBe(503);
  });

  it("shows the sign-in page, rejects the API, and lets a signed-in browser or a bearer through", async () => {
    expect((await guard(at("/"), "s3cret"))?.headers.get("content-type")).toContain("text/html");
    expect((await guard(at("/api/projects/demo/sessions"), "s3cret"))?.status).toBe(401);
    expect((await guard(at("/login", { method: "POST", body: new URLSearchParams({ password: "nope" }) }), "s3cret"))?.status).toBe(401);
    const login = await guard(at("/login", { method: "POST", body: new URLSearchParams({ password: "s3cret" }) }), "s3cret");
    expect(login?.status).toBe(303);
    const session = (login?.headers.get("set-cookie") ?? "").split(";")[0] as string;
    expect(await guard(at("/api/projects/demo/sessions", { headers: { cookie: session } }), "s3cret")).toBeNull();
    expect(await guard(at("/agents/project-agent/demo", { headers: { authorization: "Bearer s3cret" } }), "s3cret")).toBeNull();
    expect((await guard(at("/", { headers: { cookie: "kargah_access=forged" } }), "s3cret"))?.status).toBe(200);
  });
});
