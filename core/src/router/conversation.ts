export interface ChatTurn {
  readonly prompt: string;
  readonly reply: string;
  readonly at: number;
}

export interface ChatMemory {
  readonly summary: string;
  readonly turns: readonly ChatTurn[];
  readonly summarized?: number;
}

export interface ChatContext {
  readonly used: number;
  readonly limit: number;
  readonly turns: number;
  readonly summarized: number;
}

export const CHAT_CONTEXT_TOKENS = 160_000;
const REPLY_CHARS = 600;
const SUMMARY_CHARS = 6_000;

export function tokensOf(text: string): number {
  return Math.ceil(text.length / 4);
}

export function renderTurn(turn: ChatTurn): string {
  return `Person: ${turn.prompt}\nchef: ${turn.reply.slice(0, REPLY_CHARS)}`;
}

export function readChatMemory(stored: unknown): ChatMemory {
  if (stored && typeof stored === "object" && "turns" in stored) return stored as ChatMemory;
  return { summary: "", turns: [] };
}

export function needsCompacting(memory: ChatMemory, limit = CHAT_CONTEXT_TOKENS): boolean {
  return tokensOf(renderConversation(memory)) > limit;
}

export function chatContext(memory: ChatMemory, summarized: number): ChatContext {
  return { used: tokensOf(renderConversation(memory)), limit: CHAT_CONTEXT_TOKENS, turns: memory.turns.length, summarized };
}

export function splitForCompacting(memory: ChatMemory, keep = CHAT_CONTEXT_TOKENS / 4): { readonly older: readonly ChatTurn[]; readonly recent: readonly ChatTurn[] } {
  let used = 0;
  let at = memory.turns.length;
  while (at > 0) {
    const size = tokensOf(renderTurn(memory.turns[at - 1] as ChatTurn));
    if (used + size > keep && at < memory.turns.length) break;
    used += size;
    at--;
  }
  return { older: memory.turns.slice(0, at), recent: memory.turns.slice(at) };
}

export function plainSummary(summary: string, older: readonly ChatTurn[]): string {
  const lines = older.map((t) => `- ${t.prompt.slice(0, 160)} → ${t.reply.slice(0, 120)}`);
  return [summary, ...lines].filter(Boolean).join("\n").slice(-SUMMARY_CHARS);
}

export function renderConversation(memory: ChatMemory): string {
  return [memory.summary ? `Summary of the earlier chat:\n${memory.summary}` : "", memory.turns.length ? `Recent messages, oldest first:\n${memory.turns.map(renderTurn).join("\n\n")}` : ""].filter(Boolean).join("\n\n");
}
