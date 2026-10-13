import type { FeatureSpec } from "../spec/schema.ts";

export interface ChatTurn {
  readonly prompt: string;
  readonly reply: string;
  readonly at: number;
}

export interface ChatContext {
  readonly used: number;
  readonly limit: number;
  readonly turns: number;
  readonly dropped: number;
}

export const CHAT_CONTEXT_TOKENS = 32_000;
export const CHAT_TURNS_KEPT = 200;
const REPLY_CHARS = 600;

export function tokensOf(text: string): number {
  return Math.ceil(text.length / 4);
}

function renderTurn(turn: ChatTurn): string {
  return `Person: ${turn.prompt}\nchef: ${turn.reply.slice(0, REPLY_CHARS)}`;
}

export function featureList(spec: readonly FeatureSpec[]): string {
  return JSON.stringify(spec.map((f) => ({ id: f.id, title: f.title, ...(f.parent ? { parent: f.parent } : {}) })));
}

export function conversation(turns: readonly ChatTurn[], spec: readonly FeatureSpec[], limit = CHAT_CONTEXT_TOKENS): { readonly text: string; readonly context: ChatContext } {
  const base = tokensOf(featureList(spec));
  const kept: string[] = [];
  let used = base;
  for (const turn of [...turns].reverse()) {
    const text = renderTurn(turn);
    if (used + tokensOf(text) > limit) break;
    kept.unshift(text);
    used += tokensOf(text);
  }
  return { text: kept.join("\n\n"), context: { used, limit, turns: kept.length, dropped: turns.length - kept.length } };
}
