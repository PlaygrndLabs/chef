import { describe, expect, it } from "vitest";
import { guard, hashPassword, type Credential, type StoredPassword } from "../../src/access.ts";

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
});
