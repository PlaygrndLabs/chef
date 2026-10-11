export interface FlowStep {
  readonly name: string;
  readonly request: { readonly method: string; readonly path: string; readonly body?: unknown };
  readonly expect: (response: { status: number; body: unknown }) => string | null;
}

export interface Flow {
  readonly feature: string;
  readonly steps: readonly FlowStep[];
}
