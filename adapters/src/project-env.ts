import { z } from "zod";
import { envProblem, type EnvNeed, type EnvVar } from "@chef/core";
import { keyHint } from "./settings.ts";

export interface StoredEnvVar {
  readonly secret: boolean;
  readonly value: string;
  readonly updatedAt: number;
}

export type StoredEnv = Readonly<Record<string, StoredEnvVar>>;

export interface EnvVarView extends EnvVar {
  readonly value: string | null;
  readonly hint?: string;
  readonly updatedAt: number;
  readonly scope?: "shared" | "overrides";
}

export interface ProjectEnvView {
  readonly vars: readonly EnvVarView[];
  readonly needs: readonly EnvNeed[];
}

export interface PlainEnvVar extends EnvVar {
  readonly value: string;
}

export const MAX_ENV_VARS = 100;
export const MAX_ENV_VALUE = 5 * 1024;

const EnvUpdate = z.strictObject({
  set: z
    .record(
      z.string(),
      z.strictObject({
        value: z.string().min(1, "a value cannot be empty").max(MAX_ENV_VALUE, `a value is at most ${MAX_ENV_VALUE} characters`),
        secret: z.boolean().default(true),
      }),
    )
    .default({}),
  remove: z.array(z.string()).default([]),
});

export interface EnvCipher {
  encrypt(text: string): Promise<string>;
  decrypt(sealed: string): Promise<string>;
}

export async function applyEnvUpdate(stored: StoredEnv, body: unknown, cipher: EnvCipher, now: number): Promise<{ ok: true; env: StoredEnv } | { ok: false; error: string }> {
  const parsed = EnvUpdate.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  const removed = new Set(parsed.data.remove);
  const next: Record<string, StoredEnvVar> = Object.fromEntries(Object.entries(stored).filter(([name]) => !removed.has(name)));
  for (const [rawName, entry] of Object.entries(parsed.data.set)) {
    const name = rawName.trim();
    const problem = envProblem(name);
    if (problem) return { ok: false, error: problem };
    next[name] = { secret: entry.secret, value: await cipher.encrypt(entry.value), updatedAt: now };
  }
  if (Object.keys(next).length > MAX_ENV_VARS) return { ok: false, error: `a project holds at most ${MAX_ENV_VARS} variables` };
  return { ok: true, env: next };
}

export function envNames(stored: StoredEnv): EnvVar[] {
  return Object.entries(stored)
    .map(([name, entry]) => ({ name, secret: entry.secret }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function viewEnv(stored: StoredEnv, cipher: EnvCipher, needs: readonly EnvNeed[]): Promise<ProjectEnvView> {
  const vars = await Promise.all(
    Object.entries(stored).map(async ([name, entry]) => {
      const value = await cipher.decrypt(entry.value);
      return entry.secret ? { name, secret: true, value: null, hint: keyHint(value), updatedAt: entry.updatedAt } : { name, secret: false, value, updatedAt: entry.updatedAt };
    }),
  );
  return { vars: vars.sort((a, b) => a.name.localeCompare(b.name)), needs };
}

export function mergeEnv(shared: StoredEnv, own: StoredEnv): StoredEnv {
  return { ...shared, ...own };
}

export async function viewProjectEnv(own: StoredEnv, shared: StoredEnv, cipher: EnvCipher, needs: readonly EnvNeed[]): Promise<ProjectEnvView> {
  const view = await viewEnv(mergeEnv(shared, own), cipher, needs);
  return { ...view, vars: view.vars.map((item) => (!(item.name in own) ? { ...item, scope: "shared" as const } : item.name in shared ? { ...item, scope: "overrides" as const } : item)) };
}

export async function revealEnv(stored: StoredEnv, cipher: EnvCipher): Promise<PlainEnvVar[]> {
  const vars = await Promise.all(Object.entries(stored).map(async ([name, entry]) => ({ name, secret: entry.secret, value: await cipher.decrypt(entry.value) })));
  return vars.sort((a, b) => a.name.localeCompare(b.name));
}

export async function aesCipher(rawKey: Uint8Array<ArrayBuffer>): Promise<EnvCipher> {
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    async encrypt(text) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
      return `v1.${toBase64(iv)}.${toBase64(sealed)}`;
    },
    async decrypt(sealed) {
      const [version, iv, data] = sealed.split(".");
      if (version !== "v1" || !iv || !data) throw new Error("an environment value is not in a format chef can read");
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(data)));
    },
  };
}

export function newEnvKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export function envKeyBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const bytes = fromBase64(encoded);
  if (bytes.length !== 32) throw new Error("the environment key must be 32 bytes");
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
