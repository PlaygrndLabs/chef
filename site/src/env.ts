import type { Members } from "./directory.ts";
import type { Member } from "./member.ts";
import type { OAuthClient } from "./oauth.ts";

export interface Env {
  readonly ASSETS: Fetcher;
  readonly MEMBER: DurableObjectNamespace<Member>;
  readonly MEMBERS: DurableObjectNamespace<Members>;
  readonly OAUTH_CLIENT_ID?: string;
  readonly OAUTH_CLIENT_SECRET?: string;
  readonly OAUTH_SCOPES?: string;
  readonly SANDBOX_IMAGE?: string;
  readonly ENGINE_VERSION?: string;
  readonly CF_ACCOUNT_ID?: string;
  readonly CF_API_TOKEN?: string;
}

export function oauthClient(env: Env): OAuthClient | null {
  return env.OAUTH_CLIENT_ID && env.OAUTH_CLIENT_SECRET && env.OAUTH_SCOPES ? { clientId: env.OAUTH_CLIENT_ID, clientSecret: env.OAUTH_CLIENT_SECRET, scopes: env.OAUTH_SCOPES } : null;
}

export function directory(env: Env): DurableObjectStub<Members> {
  return env.MEMBERS.get(env.MEMBERS.idFromName("all"));
}
