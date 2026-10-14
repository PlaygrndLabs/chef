import type { Backoffice } from "../../site/src/backoffice.ts";

export interface Env {
  readonly ASSETS: Fetcher;
  readonly SITE: Service<Backoffice>;
  readonly SITE_URL: string;
  readonly SESSION_SECRET?: string;
}
