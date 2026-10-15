import { describe, expect, it } from "vitest";

interface Container {
  readonly service: string;
  readonly state: string;
  readonly exitCode: number;
  readonly restarts: number;
}

interface AppScript {
  appPort(config: unknown): number | null;
  appService(config: unknown): string | null;
  stackTrouble(containers: readonly Container[], service: string | null): { service: string; reason: string } | null;
  buildError(logs: string): string | null;
  inspected(text: string): Container[];
}

const script = new URL("../../sandbox/app.mjs", import.meta.url).href;
const app = (await import(script)) as AppScript;

const running = (service: string): Container => ({ service, state: "running", exitCode: 0, restarts: 0 });

describe("the sandbox app script", () => {
  it("finds the service that serves the app's port", () => {
    const config = { services: { db: { image: "postgres" }, web: { build: ".", ports: ["8787:8787"] } } };
    expect(app.appPort(config)).toBe(8787);
    expect(app.appService(config)).toBe("web");
    expect(app.appService({ services: { web: { ports: ["3000:3000"] }, api: { labels: { "chef.port": "8080" } } } })).toBe("api");
    expect(app.appService({ services: { worker: { image: "x" } } })).toBeNull();
  });

  it("calls a stack failed when a service exits with an error, crash loops, or the app's service stops", () => {
    expect(app.stackTrouble([running("web"), running("db")], "web")).toBeNull();
    expect(app.stackTrouble([running("web"), { service: "migrate", state: "exited", exitCode: 0, restarts: 0 }], "web")).toBeNull();
    expect(app.stackTrouble([{ service: "web", state: "exited", exitCode: 1, restarts: 0 }], "web")).toEqual({ service: "web", reason: "web stopped with exit code 1" });
    expect(app.stackTrouble([{ service: "web", state: "exited", exitCode: 0, restarts: 0 }], "web")?.reason).toBe("web stopped before it answered");
    expect(app.stackTrouble([running("web"), { service: "db", state: "restarting", exitCode: 1, restarts: 1 }], "web")?.reason).toBe("db keeps crashing and restarting");
    expect(app.stackTrouble([{ service: "web", state: "running", exitCode: 0, restarts: 3 }], "web")?.service).toBe("web");
  });

  it("spots a build error in a service's logs", () => {
    const wrangler = ["\u001b[32m⛅️ wrangler 4.149.0\u001b[0m", "", '✘ [ERROR] Could not resolve "../page.ts"', "", "    features/order/backend/api.ts:31:22:"].join("\n");
    expect(app.buildError(wrangler)).toBe('✘ [ERROR] Could not resolve "../page.ts"');
    expect(app.buildError("Failed to compile.\n./src/App.tsx")).toBe("Failed to compile.");
    expect(app.buildError("Ready on http://0.0.0.0:8787\n[wrangler:info] GET / 200 OK")).toBeNull();
  });

  it("reads containers from docker inspect", () => {
    const text = `WARN noise\n${JSON.stringify([{ Name: "/shop-web-1", Config: { Labels: { "com.docker.compose.service": "web" } }, State: { Status: "exited", ExitCode: 137 }, RestartCount: 2 }])}`;
    expect(app.inspected(text)).toEqual([{ service: "web", state: "exited", exitCode: 137, restarts: 2 }]);
    expect(app.inspected("not json")).toEqual([]);
  });
});
