import type { Flow } from "../shared/flow.ts";

export interface StepResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DriveResult {
  readonly feature: string;
  readonly url: string;
  readonly ok: boolean;
  readonly steps: readonly StepResult[];
}

export type Fetcher = (request: Request) => Promise<Response>;

export async function drive(flow: Flow, baseUrl: string, fetcher: Fetcher = (request) => fetch(request)): Promise<DriveResult> {
  const steps: StepResult[] = [];
  for (const step of flow.steps) {
    const init: RequestInit = { method: step.request.method };
    if (step.request.body !== undefined) {
      init.body = JSON.stringify(step.request.body);
      init.headers = { "content-type": "application/json" };
    }
    try {
      const response = await fetcher(new Request(new URL(step.request.path, baseUrl), init));
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      const problem = step.expect({ status: response.status, body });
      steps.push({ name: step.name, ok: problem === null, detail: problem ?? `${response.status} ${text.slice(0, 200)}` });
    } catch (error) {
      steps.push({ name: step.name, ok: false, detail: (error as Error).message });
    }
    if (!steps.at(-1)?.ok) break;
  }
  return { feature: flow.feature, url: baseUrl, ok: steps.length === flow.steps.length && steps.every((s) => s.ok), steps };
}
