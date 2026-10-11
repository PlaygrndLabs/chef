import { json, type Feature } from "../../shared/http.ts";

export const feature: Feature = {
  id: "home",
  title: "Home",
  routes: [{ method: "GET", path: "/", handle: () => json({ ok: true, app: "kargah-project" }) }],
};
