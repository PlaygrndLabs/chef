import type { Tree } from "../git/tree.ts";

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly log: string;
}

export interface CheckRunner {
  run(input: { repo: string; commitId: string; tree: Tree }): Promise<CheckResult[]>;
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

export interface ProofRunner {
  prove(input: { repo: string; feature: string; flow: string; url: string; commitId: string; tree: Tree }): Promise<ProofRecord>;
}
