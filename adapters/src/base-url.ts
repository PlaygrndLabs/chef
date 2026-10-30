export function apiRoot(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/([^/:])\/+v1$/, "$1");
}

export function v1Base(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/v1"}`;
}
