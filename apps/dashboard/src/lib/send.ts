export function sendError(message: string): string | null {
  const refused = /^prompts failed: \d+ (.*)$/s.exec(message.trim());
  if (!refused) return null;
  try {
    const body = JSON.parse(refused[1] ?? "") as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error.trim() : null;
  } catch {
    return null;
  }
}
