const PROJECT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/(bootstrap|overview|prompts|route|sessions|events|cursor|voice|spec|live|settings|env|budget|preview-key|instructions|memory|agents|agents\/restore|git|git\/sync|features\/[a-z][a-z0-9-]{0,39}|sessions\/[a-z0-9-]{1,40}(?:\/(?:drop|retry|steer|turns|changes|cloudflare))?)$/;
const PREVIEW = /^\/preview\/([a-z][a-z0-9-]{1,30})\/[a-z0-9-]{1,80}\/?$/;

export function projectOf(pathname: string): string | null {
  return (PROJECT.exec(pathname) ?? PREVIEW.exec(pathname))?.[1] ?? null;
}
