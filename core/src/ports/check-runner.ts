import type { Tree } from "../git/tree.ts";

export interface TestCase {
  readonly name: string;
  readonly ok: boolean;
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly log: string;
  readonly cases?: readonly TestCase[];
  readonly ms?: number;
}

export interface CheckRunner {
  run(input: { repo: string; commitId: string; tree: Tree; features?: readonly string[] }): Promise<CheckResult[]>;
}

export interface ProofRecord {
  readonly feature: string;
  readonly flow: string;
  readonly url: string;
  readonly commitId: string;
  readonly ok: boolean;
  readonly steps: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[];
  readonly at: number;
}

export interface ProbeInput {
  readonly repo: string;
  readonly feature: string;
  readonly url: string;
  readonly path: string;
  readonly commitId: string;
}

export interface ProofRunner {
  prove(input: { repo: string; feature: string; flow: string; url: string; commitId: string; tree: Tree }): Promise<ProofRecord>;
  probe?(input: ProbeInput): Promise<ProofRecord>;
}
