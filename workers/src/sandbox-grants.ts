export interface CloudflareGrant {
  readonly accountId: string;
  readonly worker: string;
}

export const PLACEHOLDER = "chef-placeholder";

export function cloudflareAllowed(url: URL, grant: CloudflareGrant): boolean {
  if (url.hostname !== "api.cloudflare.com") return false;
  const base = `/client/v4/accounts/${grant.accountId}/workers`;
  const path = url.pathname.replace(/\/$/, "");
  return path === `${base}/workers` || path === `${base}/subdomain` || [`${base}/workers/${grant.worker}`, `${base}/scripts/${grant.worker}`, `${base}/services/${grant.worker}`].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
