import type { CheckResult } from "../ports/check-runner.ts";

export const ALREADY_FAILING = "This check already fails on main without this change, so it does not block it.";

export type MainFailures = ReadonlyMap<string, ReadonlySet<string> | null>;

export function failuresOf(results: readonly CheckResult[]): MainFailures {
  return new Map(results.filter((r) => !r.ok).map((r) => [r.name, r.cases ? new Set(r.cases.filter((c) => !c.ok).map((c) => c.name)) : null]));
}

export function newFailuresOnly(results: readonly CheckResult[], onMain: MainFailures): CheckResult[] {
  return results.map((result) => {
    if (result.ok || !onMain.has(result.name)) return result;
    const before = onMain.get(result.name);
    if (before && result.cases && result.cases.some((c) => !c.ok && !before.has(c.name))) return result;
    return { ...result, ok: true, log: `${ALREADY_FAILING}\n\n${result.log}` };
  });
}
