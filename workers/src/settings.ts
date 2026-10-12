import { DurableObject } from "cloudflare:workers";
import { applyUpdate, describeSettings, effectiveSettings, NO_SETTINGS, type ProviderSettings } from "@chef/adapters/providers";

const KEY = "providers";

export class Settings extends DurableObject<Env> {
  async read(): Promise<ProviderSettings> {
    return (await this.ctx.storage.get<ProviderSettings>(KEY)) ?? NO_SETTINGS;
  }

  async write(settings: ProviderSettings): Promise<void> {
    await this.ctx.storage.put(KEY, settings);
  }
}

function stub(env: Env): DurableObjectStub<Settings> {
  return env.SETTINGS.get(env.SETTINGS.idFromName("global"));
}

export async function savedSettings(env: Env): Promise<ProviderSettings> {
  return stub(env).read();
}

export async function currentSettings(env: Env): Promise<ProviderSettings> {
  return effectiveSettings(await savedSettings(env), env);
}

export async function settingsRequest(request: Request, env: Env): Promise<Response> {
  const saved = await savedSettings(env);
  if (request.method === "GET") return Response.json(describeSettings(saved, env));
  if (request.method === "PUT") {
    const result = applyUpdate(saved, await request.json().catch(() => null));
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    await stub(env).write(result.settings);
    return Response.json(describeSettings(result.settings, env));
  }
  return Response.json({ error: "method not allowed" }, { status: 405 });
}
