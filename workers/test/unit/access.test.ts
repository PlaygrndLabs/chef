import { describe, expect, it } from "vitest";
import { deploymentPassword, EXAMPLE_PASSWORD, guard, hashPassword, siteOrigin, type Credential, type StoredPassword } from "../../src/access.ts";

const at = (path: string, init?: RequestInit) => new Request(`https://chef.example${path}`, init);
const form = (fields: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(fields) });
const never = async () => false;

async function signsInWith(credential: Credential, password: string) {
  expect((await guard(at("/"), credential, never))?.headers.get("content-type")).toContain("text/html");
  expect((await guard(at("/api/projects/demo/sessions"), credential, never))?.status).toBe(401);
  expect((await guard(at("/login", form({ password: "nope-nope" })), credential, never))?.status).toBe(401);
  const login = await guard(at("/login", form({ password })), credential, never);
  expect(login?.status).toBe(303);
  const session = (login?.headers.get("set-cookie") ?? "").split(";")[0] as string;
  expect(await guard(at("/api/projects/demo/sessions", { headers: { cookie: session } }), credential, never)).toBeNull();
  expect(await guard(at("/agents/project/demo", { headers: { authorization: `Bearer ${password}` } }), credential, never)).toBeNull();
  expect((await guard(at("/", { headers: { cookie: "chef_access=forged" } }), credential, never))?.status).toBe(200);
}

describe("dashboard access", () => {
  it("ignores an empty or example CHEF_PASSWORD so a one-click deploy never ships a known password", () => {
    expect(deploymentPassword({})).toBeNull();
    expect(deploymentPassword({ CHEF_PASSWORD: "  " })).toBeNull();
    expect(deploymentPassword({ CHEF_PASSWORD: EXAMPLE_PASSWORD })).toBeNull();
    expect(deploymentPassword({ CHEF_PASSWORD: "a real password" })).toBe("a real password");
  });

  it("asks the first visitor to set a password and refuses the API until then", async () => {
    expect((await guard(at("/api/projects/demo/sessions"), null, never))?.status).toBe(503);
    const setup = await guard(at("/"), null, never);
    expect(await setup?.text()).toContain("Set the password");
    expect((await guard(at("/setup", form({ password: "short", confirm: "short" })), null, never))?.status).toBe(400);
    expect((await guard(at("/setup", form({ password: "long enough", confirm: "different" })), null, never))?.status).toBe(400);
    let stored: StoredPassword | null = null;
    const claim = async (password: StoredPassword) => {
      if (stored) return false;
      stored = password;
      return true;
    };
    const done = await guard(at("/setup", form({ password: "long enough", confirm: "long enough" })), null, claim);
    expect(done?.status).toBe(303);
    expect(done?.headers.get("set-cookie")).toContain("chef_access=");
    expect(stored).not.toBeNull();
    const late = await guard(at("/setup", form({ password: "someone else", confirm: "someone else" })), null, claim);
    expect(late?.headers.get("set-cookie")).toBeNull();
  });

  it("signs in with the deployment's password", async () => {
    await signsInWith({ kind: "deployment", password: "s3cret-pass" }, "s3cret-pass");
  });

  it("signs in with a password set in the app", async () => {
    await signsInWith({ kind: "app", ...(await hashPassword("app password")) }, "app password");
  });

  it("reads the site that installed chef, ignoring anything that is not a web address", () => {
    expect(siteOrigin({})).toBeNull();
    expect(siteOrigin({ CHEF_SITE: "not a url" })).toBeNull();
    expect(siteOrigin({ CHEF_SITE: "javascript:alert(1)" })).toBeNull();
    expect(siteOrigin({ CHEF_SITE: " https://chef.example/ " })).toBe("https://chef.example");
  });

  it("only answers the site when the site installed it: no own dashboard, sign-in or setup page", async () => {
    const site = "https://chef.example";
    const credential: Credential = { kind: "deployment", password: "site-secret" };
    const home = await guard(at("/"), credential, never, site);
    expect(home?.status).toBe(302);
    expect(home?.headers.get("location")).toBe(site);
    expect((await guard(at("/project/demo"), credential, never, site))?.headers.get("location")).toBe(site);
    expect((await guard(at("/login", form({ password: "site-secret" })), credential, never, site))?.status).toBe(302);
    expect((await guard(at("/setup", form({ password: "long enough", confirm: "long enough" })), null, never, site))?.status).toBe(302);
    const api = await guard(at("/api/projects"), credential, never, site);
    expect(api?.status).toBe(401);
    expect(await api?.json()).toEqual({ error: `open chef at ${site}` });
    expect((await guard(at("/api/projects", { headers: { authorization: "Bearer wrong" } }), credential, never, site))?.status).toBe(401);
    expect(await guard(at("/api/projects", { headers: { authorization: "Bearer site-secret" } }), credential, never, site)).toBeNull();
    expect(await guard(at("/preview/demo/abc", { headers: { authorization: "Bearer site-secret" } }), credential, never, site)).toBeNull();
    expect(await guard(at("/agents/project/demo", { headers: { authorization: "Bearer site-secret" } }), credential, never, site)).toBeNull();
  });
});
