import type { OAuthClient } from "./oauth.ts";
import type { Setup } from "./setup.ts";

export interface Env {
  readonly ASSETS: Fetcher;
  readonly SETUP: DurableObjectNamespace<Setup>;
  readonly OAUTH_CLIENT_ID?: string;
  readonly OAUTH_CLIENT_SECRET?: string;
  readonly OAUTH_SCOPES?: string;
  readonly SANDBOX_IMAGE?: string;
  readonly CF_ACCOUNT_ID?: string;
  readonly CF_API_TOKEN?: string;
}

export function oauthClient(env: Env): OAuthClient | null {
  return env.OAUTH_CLIENT_ID && env.OAUTH_CLIENT_SECRET && env.OAUTH_SCOPES ? { clientId: env.OAUTH_CLIENT_ID, clientSecret: env.OAUTH_CLIENT_SECRET, scopes: env.OAUTH_SCOPES } : null;
}
