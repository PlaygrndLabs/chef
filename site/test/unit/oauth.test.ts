import { describe, expect, it } from "vitest";
import { authorizeUrl, challengeFor, cookies, decodePending, encodePending, planFrom, readGrant, readInstall, readProfile, readSession, setCookie, signSession, tokenRequest } from "../../src/oauth.ts";

const client = { clientId: "abc", clientSecret: "shh", scopes: "a.read b.write" };

describe("Cloudflare sign-in", () => {
  it("sends the visitor to Cloudflare's consent page with PKCE", async () => {
    const url = new URL(await authorizeUrl(client, "https://getchef.example/callback", { state: "st", verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" }));
    expect(url.origin + url.pathname).toBe("https://dash.cloudflare.com/oauth2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "abc",
      redirect_uri: "https://getchef.example/callback",
      scope: "a.read b.write",
      state: "st",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("exchanges the code with the client secret in a Basic header", async () => {
    const request = tokenRequest(client, { grant_type: "authorization_code", code: "c1" });
    expect(request.url).toBe("https://dash.cloudflare.com/oauth2/token");
    expect(request.headers.get("authorization")).toBe(`Basic ${btoa("abc:shh")}`);
    expect(await request.text()).toBe("grant_type=authorization_code&code=c1");
  });

  it("keeps the token no longer than an hour", () => {
    expect(readGrant({ access_token: "t", expires_in: 900 }, 0)).toEqual({ token: "t", expiresAt: 900_000 });
    expect(readGrant({ access_token: "t", expires_in: 86_400 }, 0)).toEqual({ token: "t", expiresAt: 3_600_000 });
    expect(readGrant({ error: "denied" }, 0)).toBeNull();
  });

  it("reads and writes its cookies", () => {
    expect(cookies("a=1; chef_oauth=st.ver; b=x%20y")).toEqual({ a: "1", chef_oauth: "st.ver", b: "x y" });
    expect(setCookie("chef_session", "v", 60)).toBe("chef_session=v; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax");
    expect(decodePending(encodePending({ state: "s", verifier: "v" }))).toEqual({ state: "s", verifier: "v" });
    expect(decodePending("nodot")).toBeNull();
  });

  it("signs sessions so only this site can mint them, and lets them expire", async () => {
    const cookie = await signSession("secret", "user1", 0);
    expect(await readSession("secret", cookie, 1000)).toBe("user1");
    expect(await readSession("other", cookie, 1000)).toBeNull();
    expect(await readSession("secret", cookie.replace("user1", "user2"), 1000)).toBeNull();
    expect(await readSession("secret", cookie, 31 * 24 * 3600 * 1000)).toBeNull();
    expect(await readSession("secret", undefined, 0)).toBeNull();
  });

  it("reads who signed in and which account they chose", () => {
    expect(readProfile({ result: { id: "abc123", email: "sam@example.com" } })).toEqual({ id: "abc123", email: "sam@example.com" });
    expect(readProfile({ result: { id: "../x" } })).toBeNull();
    const accountId = "0123456789abcdef0123456789abcdef";
    expect(readInstall({ accountId })).toEqual({ accountId });
    expect(readInstall({ accountId: "nope" })).toBe("choose a Cloudflare account");
  });

  it("tells Workers Paid apart from a free account", () => {
    expect(planFrom([{ rate_plan: { id: "workers_paid", public_name: "Workers Paid" }, state: "Paid" }])).toBe("paid");
    expect(planFrom([{ rate_plan: { id: "free", public_name: "Free Website" } }])).toBe("free");
    expect(planFrom(null)).toBe("unknown");
  });
});
