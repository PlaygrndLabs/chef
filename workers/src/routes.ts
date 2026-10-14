const PROJECT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/(bootstrap|overview|prompts|route|sessions|events|cursor|voice|spec|live|settings|env|budget|instructions|memory|agents|agents\/restore|git|git\/sync|history|history\/[0-9a-f]{7,64}|features\/[a-z][a-z0-9-]{0,39}|sessions\/[a-z0-9-]{1,40}(?:\/(?:drop|retry|steer|turns|changes|cloudflare|history|history\/[0-9a-f]{7,64}))?)$/;
const PREVIEW = /^\/preview\/([a-z][a-z0-9-]{1,30})\/[a-z0-9-]{1,80}\/?$/;

export function projectOf(pathname: string): string | null {
  return (PROJECT.exec(pathname) ?? PREVIEW.exec(pathname))?.[1] ?? null;
}
