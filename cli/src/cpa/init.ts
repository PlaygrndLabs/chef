import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CPA_URL = "http://127.0.0.1:8327";

export interface CpaInit {
  readonly config: string;
  readonly devVars: string;
  readonly created: boolean;
}

function existingKey(config: string): string | null {
  if (!existsSync(config)) return null;
  const parsed = JSON.parse(readFileSync(config, "utf8")) as { "api-keys"?: unknown };
  const keys = parsed["api-keys"];
  return Array.isArray(keys) && typeof keys[0] === "string" && keys[0].length >= 32 ? keys[0] : null;
}

export function renderConfig(key: string): string {
  const config = {
    host: "",
    port: 8317,
    "auth-dir": "/auth",
    "api-keys": [key],
    "request-retry": 0,
    "logging-to-file": false,
    "request-log": false,
    debug: false,
    "passthrough-headers": false,
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function upsertVars(text: string, values: Readonly<Record<string, string>>): string {
  const lines = text.split("\n").filter((line) => line.trim() !== "" && !Object.keys(values).some((name) => line.startsWith(`${name}=`)));
  for (const [name, value] of Object.entries(values)) lines.push(`${name}=${value}`);
  return `${lines.join("\n")}\n`;
}

export function cpaInit(root: string): CpaInit {
  const state = join(root, "dev", "cpa", "state");
  mkdirSync(join(state, "auth"), { recursive: true, mode: 0o700 });
  const config = join(state, "config.yaml");
  const found = existingKey(config);
  const key = found ?? randomBytes(32).toString("hex");
  writeFileSync(config, renderConfig(key), { mode: 0o600 });
  chmodSync(config, 0o600);
  mkdirSync(join(root, "workers"), { recursive: true });
  const devVars = join(root, "workers", ".dev.vars");
  const current = existsSync(devVars) ? readFileSync(devVars, "utf8") : "";
  writeFileSync(devVars, upsertVars(current, { CPA_BASE_URL: CPA_URL, CPA_API_KEY: key }), { mode: 0o600 });
  return { config, devVars, created: found === null };
}
