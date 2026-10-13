export function replayFrom(url: string): number {
  const after = Number(new URL(url, "http://localhost").searchParams.get("after"));
  return Number.isSafeInteger(after) && after > 0 ? after : 0;
}

export interface CaughtUp {
  readonly caughtUp: number;
}

export function caughtUp(seq: number): CaughtUp {
  return { caughtUp: seq };
}

export function isCaughtUp(message: unknown): message is CaughtUp {
  return typeof message === "object" && message !== null && typeof (message as { caughtUp?: unknown }).caughtUp === "number";
}
