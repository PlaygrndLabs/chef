import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appJwt, appManifest, appName, convertManifest, GitHubApp, installUrl, manifestAction, type GitHubAppCredentials } from "../../src/github-app.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const credentials: GitHubAppCredentials = { id: 42, slug: "chef-acme-ab12", name: "chef-acme-ab12", owner: "acme", htmlUrl: "https://github.com/apps/chef-acme-ab12", clientId: "Iv1", clientSecret: "cs", webhookSecret: "wh", pem: privateKey };

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

describe("chef's GitHub App", () => {
  it("describes an app that gets push events and can open pull requests, coming back to this Chef", () => {
    const manifest = appManifest("https://chef.acme.workers.dev", "chef-acme-ab12");
    expect(manifest).toMatchObject({
      hook_attributes: { url: "https://chef.acme.workers.dev/api/github/webhook" },
      redirect_url: "https://chef.acme.workers.dev/api/github/created",
      setup_url: "https://chef.acme.workers.dev/api/github/installed",
      public: false,
      default_permissions: { contents: "write", pull_requests: "write", metadata: "read" },
      default_events: ["push"],
    });
    expect(appManifest("https://chef.acme.workers.dev", "chef-acme-ab12", "https://chef.example.com")).toMatchObject({
      url: "https://chef.example.com",
      hook_attributes: { url: "https://chef.acme.workers.dev/api/github/webhook" },
      redirect_url: "https://chef.example.com/api/github/created",
      setup_url: "https://chef.example.com/api/github/installed",
    });
    expect(appName("chef.playgrndlabs.workers.dev", "ab12")).toBe("chef-playgrndlabs-ab12");
    expect(appName("chef.a-very-long-account-name-that-goes-on.workers.dev", "ab12").length).toBeLessThanOrEqual(34);
    expect(manifestAction(null, "s1")).toBe("https://github.com/settings/apps/new?state=s1");
    expect(manifestAction("PlaygrndLabs", "s1")).toBe("https://github.com/organizations/PlaygrndLabs/settings/apps/new?state=s1");
    expect(installUrl(credentials, "s1")).toBe("https://github.com/apps/chef-acme-ab12/installations/new?state=s1");
  });

  it("signs an RS256 app token GitHub can verify from the PKCS#1 key it hands out", async () => {
    const jwt = await appJwt(credentials, 1_700_000_000_000);
    const [header, payload, signature] = jwt.split(".") as [string, string, string];
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(payload)).toEqual({ iat: 1_699_999_940, exp: 1_700_000_540, iss: "42" });
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPublicKey(publicKey), Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("turns the manifest code into stored credentials", async () => {
    const fetcher = (async (url: string, init: RequestInit = {}) => {
      expect(init.method).toBe("POST");
      expect(url).toBe("https://api.github.com/app-manifests/c0de/conversions");
      return Response.json({ id: 42, slug: "chef-acme-ab12", name: "chef-acme-ab12", owner: { login: "acme" }, html_url: "https://github.com/apps/chef-acme-ab12", client_id: "Iv1", client_secret: "cs", webhook_secret: "wh", pem: "PEM" }, { status: 201 });
    }) as unknown as typeof fetch;
    expect(await convertManifest("c0de", { fetcher })).toEqual({ ...credentials, pem: "PEM" });
  });

  it("lists the repositories of every installation and reuses access tokens until they near expiry", async () => {
    const calls: string[] = [];
    let now = 1_700_000_000_000;
    const fetcher = (async (url: string, init: RequestInit = {}) => {
      const path = url.replace("https://api.github.com", "");
      calls.push(`${init.method ?? "GET"} ${path}`);
      const auth = new Headers(init.headers).get("authorization") ?? "";
      if (path.startsWith("/app/")) expect(auth).toMatch(/^Bearer ey/);
      if (path === "/app/installations?per_page=100") return Response.json([{ id: 1 }, { id: 2 }]);
      const minted = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
      if (minted) return Response.json({ token: `tok-${minted[1]}-${calls.length}`, expires_at: new Date(now + 3_600_000).toISOString() }, { status: 201 });
      if (path.startsWith("/installation/repositories")) {
        expect(auth).toMatch(/^token tok-/);
        const repos = auth.startsWith("token tok-1") ? [{ full_name: "acme/web", html_url: "https://github.com/acme/web", default_branch: "main", private: true }] : [{ full_name: "acme/api", html_url: "https://github.com/acme/api", default_branch: "trunk", private: false }];
        return Response.json({ total_count: 1, repositories: repos });
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const app = new GitHubApp({ ...credentials, id: 7001 }, { fetcher, now: () => now });
    expect(await app.repositories()).toEqual([
      { fullName: "acme/api", url: "https://github.com/acme/api", defaultBranch: "trunk", private: false, installation: 2 },
      { fullName: "acme/web", url: "https://github.com/acme/web", defaultBranch: "main", private: true, installation: 1 },
    ]);
    expect(await app.installationFor("Acme", "WEB")).toBe(1);
    expect(await app.installationFor("acme", "other")).toBeNull();
    expect(calls.filter((c) => c.includes("access_tokens"))).toHaveLength(2);
    now += 56 * 60_000;
    const token = await app.installationToken(1);
    expect(calls.filter((c) => c.includes("access_tokens"))).toHaveLength(3);
    expect(await app.installationToken(1)).toBe(token);
  });
});
