export function replayFrom(url: string): number {
  const after = Number(new URL(url, "http://localhost").searchParams.get("after"));
  return Number.isSafeInteger(after) && after > 0 ? after : 0;
}
