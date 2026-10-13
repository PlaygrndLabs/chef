import { createHash } from "node:crypto";
import { createServer, request, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { connect, memoryStore, normalizeUrl, startApp, type LocalApp } from "../../src/app.ts";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

interface Engine {
  readonly url: string;
  readonly seen: { method: string; path: string; auth: string | undefined; body: string }[];
  password: string | null;
  close(): Promise<void>;
}

async function engine(password: string | null): Promise<Engine> {
  const seen: Engine["seen"] = [];
  const state = { password };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", path: req.url ?? "", auth: req.headers.authorization, body });
      if (state.password === null) {
        if (req.url === "/setup" && req.method === "POST") {
          const form = new URLSearchParams(body);
          if ((form.get("password") ?? "").length < 8) {
            res.writeHead(400, { "content-type": "text/html" }).end('<p class="error">The password needs at least 8 characters.</p>');
            return;
          }
          state.password = form.get("password");
          res.writeHead(303, { location: "/" }).end();
          return;
        }
        res.writeHead(503, { "content-type": "application/json" }).end('{"error":"no password yet"}');
        return;
      }
      if (req.headers.authorization !== `Bearer ${state.password}`) {
        res.writeHead(401, { "content-type": "application/json" }).end('{"error":"sign in first"}');
        return;
      }
      if (req.url === "/api/settings" && req.method === "PUT") {
        const next = (JSON.parse(body) as { password?: string }).password;
        if (next) state.password = next;
      }
      if (req.url === "/api/moved") {
        res.writeHead(303, { location: `http://127.0.0.1:${port}/elsewhere` }).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "chef_access=x" }).end(JSON.stringify({ path: req.url, method: req.method }));
    });
  });
  const sockets = new Set<{ destroy(): void }>();
  server.on("upgrade", (req, socket) => {
    sockets.add(socket);
    if (req.headers.authorization !== `Bearer ${state.password}`) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}${GUID}`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);
    const text = Buffer.from(JSON.stringify({ seq: 1, path: req.url }));
    socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    get password() {
      return state.password;
    },
    set password(value) {
      state.password = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function rawGet(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

const open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((o) => o.close()));
});

async function started(password: string | null, connected: boolean) {
  const e = await engine(password);
  const store = memoryStore(connected && password ? { url: e.url, password } : null);
  const app: LocalApp = await startApp({ port: 0, store, assets: "/nonexistent" });
  open.push(app, e);
  return { e, app, store };
}

describe("local app", () => {
  it("accepts only https addresses, or http on this computer", () => {
    expect(normalizeUrl("chef.me.workers.dev/")).toBe("https://chef.me.workers.dev");
    expect(normalizeUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(() => normalizeUrl("http://chef.me.workers.dev")).toThrow("https");
  });

  it("connects with the password, claims it on a chef that has none, and refuses a wrong one", async () => {
    const e = await engine(null);
    open.push(e);
    expect(await connect({ url: e.url, password: "short" })).toMatchObject({ ok: false, error: "The password needs at least 8 characters." });
    expect(await connect({ url: e.url, password: "long enough" })).toEqual({ ok: true, url: e.url, claimed: true });
    expect(await connect({ url: e.url, password: "long enough" })).toEqual({ ok: true, url: e.url, claimed: false });
    expect(await connect({ url: e.url, password: "wrong password" })).toMatchObject({ ok: false, status: 401 });
    expect(await connect({ url: "http://127.0.0.1:1", password: "x" })).toMatchObject({ ok: false, status: 502 });
  });

  it("asks to connect first, then forwards the API with the password and without browser cookies", async () => {
    const { e, app, store } = await started("secret pass", false);
    expect(await (await fetch(`${app.url}/api/app`)).json()).toEqual({ mode: "local", engine: null, fixed: false });
    expect((await fetch(`${app.url}/api/projects`)).status).toBe(503);
    const connected = await fetch(`${app.url}/api/app/connection`, { method: "PUT", headers: { origin: app.url, "content-type": "application/json" }, body: JSON.stringify({ url: e.url, password: "secret pass" }) });
    expect(await connected.json()).toMatchObject({ mode: "local", engine: e.url });
    expect(store.read()).toEqual({ url: e.url, password: "secret pass" });

    const listed = await fetch(`${app.url}/api/projects?x=1`, { headers: { cookie: "chef_access=browser" } });
    expect(await listed.json()).toEqual({ path: "/api/projects?x=1", method: "GET" });
    expect(listed.headers.get("set-cookie")).toBeNull();
    expect(e.seen.at(-1)?.auth).toBe("Bearer secret pass");

    const created = await fetch(`${app.url}/api/projects`, { method: "POST", headers: { origin: app.url, "content-type": "application/json" }, body: '{"name":"shop"}' });
    expect(created.status).toBe(200);
    expect(e.seen.at(-1)).toMatchObject({ method: "POST", body: '{"name":"shop"}' });

    const moved = await fetch(`${app.url}/api/moved`, { redirect: "manual" });
    expect(moved.headers.get("location")).toBe("/elsewhere");
  });

  it("refuses requests from other sites and other host names", async () => {
    const { e, app } = await started("secret pass", true);
    const before = e.seen.length;
    expect((await fetch(`${app.url}/api/projects`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
    expect((await fetch(`${app.url}/api/projects`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await fetch(`${app.url}/api/projects`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect(await rawGet(`${app.url}/api/projects`, { host: "attacker.example" })).toBe(403);
    expect((await fetch(`${app.url}/api/app/connection`, { method: "DELETE", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect(e.seen.length).toBe(before);
  });

  it("keeps working after the password is changed in Settings", async () => {
    const { e, app, store } = await started("secret pass", true);
    const changed = await fetch(`${app.url}/api/settings`, { method: "PUT", headers: { origin: app.url, "content-type": "application/json" }, body: '{"password":"new secret"}' });
    expect(changed.status).toBe(200);
    expect(e.password).toBe("new secret");
    expect(store.read()?.password).toBe("new secret");
    expect((await fetch(`${app.url}/api/projects`)).status).toBe(200);
  });

  it("carries the live WebSocket to the chef with the password", async () => {
    const { app } = await started("secret pass", true);
    const socket = new WebSocket(`${app.url.replace("http", "ws")}/agents/project/shop`);
    const message = await new Promise<string>((resolve, reject) => {
      socket.addEventListener("message", (m) => resolve(String(m.data)));
      socket.addEventListener("error", () => reject(new Error("socket failed")));
    });
    socket.close();
    expect(JSON.parse(message)).toEqual({ seq: 1, path: "/agents/project/shop" });
  });
});
