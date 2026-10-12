import type { Budget, FeatureSpec, SessionChanges, SessionRecord, SessionTurn, SubmitResult } from "@kargah/core";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `${response.status} ${response.statusText}`, response.status);
  }
  return (await response.json()) as T;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export interface SandboxStatus {
  readonly running: boolean;
  readonly exit: string | null;
}

export function projectApi(project: string) {
  const base = `/api/projects/${project}`;
  return {
    spec: () => call<{ commitId: string | null; features: FeatureSpec[] }>(`${base}/spec`),
    sessions: () => call<SessionRecord[]>(`${base}/sessions`),
    session: (id: string) => call<{ record: SessionRecord; budget: Budget }>(`${base}/sessions/${id}`),
    turns: (id: string) => call<SessionTurn[]>(`${base}/sessions/${id}/turns`),
    changes: (id: string) => call<SessionChanges>(`${base}/sessions/${id}/changes`),
    sandbox: (id: string) => call<SandboxStatus>(`${base}/sessions/${id}/sandbox`),
    drop: (id: string, reason: string) => call<{ state: string }>(`${base}/sessions/${id}/drop`, post({ reason })),
    retry: (id: string, guidance: string) => call<{ state: string }>(`${base}/sessions/${id}/retry`, post({ guidance })),
    steer: (id: string, message: string) => call<{ ok: boolean }>(`${base}/sessions/${id}/steer`, post({ message })),
    prompt: (prompt: string) => call<SubmitResult>(`${base}/prompts`, post({ prompt })),
    bootstrap: () => call<{ commitId: string; created: boolean }>(`${base}/bootstrap`, { method: "POST" }),
  };
}

export type ProjectApi = ReturnType<typeof projectApi>;
