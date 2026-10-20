import type { LaneStatus, SessionState } from "@chef/core";
import { isActive, type TimelineItem } from "./events";
import { short } from "./format";

export const STAGES = ["Plan", "Tests", "Build", "Check", "Merged"] as const;

const STAGE: Readonly<Record<SessionState, number>> = { queued: 0, planning: 0, testing: 1, coding: 2, reviewing: 3, gating: 3, merged: 4, stuck: 0, dropped: 0 };

const NOW: Readonly<Record<SessionState, string>> = {
  queued: "Waiting to start.",
  planning: "Planning the feature.",
  testing: "Writing the tests that describe it.",
  coding: "Writing the code.",
  reviewing: "A reviewer is reading the change.",
  gating: "Running the final checks.",
  merged: "Merged. Ask for a change in the chat whenever you want.",
  stuck: "Chef stopped and is waiting for you.",
  dropped: "Stopped. Press Start over to build it again.",
};

export interface Progress {
  readonly stage: number;
  readonly done: boolean;
  readonly failed: boolean;
  readonly stopped: boolean;
  readonly now: string;
}

export function stoppedAt(timeline: readonly TimelineItem[]): SessionState {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item?.kind !== "state") continue;
    if (item.to === "stuck" || item.to === "dropped") {
      if (item.from === "stuck" || item.from === "dropped") continue;
      return item.from;
    }
    return item.to;
  }
  return "planning";
}

export function progress(state: SessionState, timeline: readonly TimelineItem[]): Progress {
  const halted = state === "stuck" || state === "dropped";
  const at = halted ? stoppedAt(timeline) : state;
  const lost = state === "dropped" && timeline.some((t) => t.kind === "picked" && !t.won);
  return { stage: STAGE[at], done: state === "merged", failed: state === "stuck", stopped: state === "dropped", now: lost ? "Another try was picked over this one, so this one stopped." : NOW[state] };
}

export type UpdateIcon = "plan" | "test" | "code" | "review" | "check" | "merged" | "alert" | "stop" | "sync" | "pick";
export type UpdateTone = "ok" | "run" | "bad" | "idle";

export type Update =
  | { readonly kind: "you"; readonly key: string; readonly at: number; readonly text: string; readonly note: boolean }
  | {
      readonly kind: "chef";
      readonly key: string;
      readonly at: number;
      icon: UpdateIcon;
      tone: UpdateTone;
      text: string;
      detail: string;
      readonly tech: string[];
      readonly mark: { readonly review?: "approved" | "rejected"; readonly gate?: "passed" | "failed" };
      role?: string | null;
    };

type Step = Extract<Update, { kind: "chef" }> & { phase: SessionState; said: string; last: string; after: "review" | "gate" | "dispute" | "app" | "retry" | "reopen" | null; round: number; lane?: string; open?: boolean; outcome?: LaneStatus };

const PHASES: ReadonlySet<SessionState> = new Set(["planning", "testing", "coding", "reviewing", "gating"]);
const AFTER: Readonly<Record<string, Step["after"]>> = { review_rejected: "review", gate_failed: "gate", tests_disputed: "dispute", app_failed: "app", retried: "retry", reopened: "reopen" };
const ICON: Readonly<Partial<Record<SessionState, UpdateIcon>>> = { planning: "plan", testing: "test", coding: "code", reviewing: "review", gating: "check" };

function laneHeadline(step: Step, running: boolean): string {
  if (running) return "Working on its part on its own branch";
  if (step.outcome === "rejected") return "A rule blocked its change, so it tries again";
  if (step.outcome === "unchanged") return "Had nothing to change";
  return "Did its part";
}

function headline(step: Step, running: boolean): string {
  if (step.lane) return laneHeadline(step, running);
  switch (step.phase) {
    case "planning":
      return running ? "Planning the feature" : "Planned the feature";
    case "testing":
      if (step.after === "review") return running ? "Updating the tests the reviewer asked about" : "Updated the tests the reviewer asked about";
      if (step.after === "dispute") return running ? "Checking the failing tests against the spec" : "Checked the failing tests against the spec";
      return running ? "Writing the tests" : "Wrote the tests";
    case "coding":
      if (step.after === "review") return running ? "Fixing what the reviewer asked for" : "Fixed what the reviewer asked for";
      if (step.after === "gate") return running ? "Fixing the failed checks" : "Fixed the failed checks";
      if (step.after === "app") return running ? "Fixing the app so it starts" : "Fixed the app so it starts";
      if (step.after === "retry") return running ? "Trying again with your note" : "Tried again with your note";
      if (step.after === "reopen") return running ? "Fixing a problem found after it was merged" : "Fixed a problem found after it was merged";
      return running ? "Writing the code" : "Wrote the code";
    case "reviewing":
      return "A reviewer is reading the change";
    case "gating":
      return "Running the final checks";
    default:
      return "";
  }
}

const TOOL_VERB: Readonly<Record<string, string>> = { Bash: "Ran", Read: "Read", Write: "Created", Edit: "Edited", MultiEdit: "Edited", NotebookEdit: "Edited", Grep: "Searched for", Glob: "Looked for files", LS: "Listed", view: "Looked at", Task: "Asked a helper to" };

export function toolText(tool: string, detail: string): string {
  if (tool === "TodoWrite") return "Updated its to-do list";
  const verb = TOOL_VERB[tool];
  if (!verb) return `${tool} ${detail}`.trim();
  if (detail) return `${verb} ${detail}`;
  return tool === "Bash" ? "Ran a command" : verb;
}

function lastLine(text: string): string {
  const line = text.trim().split("\n").filter(Boolean).at(-1) ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

export function updates(timeline: readonly TimelineItem[], state: SessionState, root?: { readonly prompt: string; readonly at: number }): Update[] {
  const list: Update[] = [];
  if (root) list.push({ kind: "you", key: "root", at: root.at, text: stripFeatureTag(root.prompt).text, note: false });
  const steps: Step[] = [];
  let step: Step | null = null;
  let round = 1;
  const lanes = new Map<string, Step>();
  const tech = (line: string) => step?.tech.push(line);
  const laneOf = (item: TimelineItem) => ("lane" in item && item.lane ? (lanes.get(item.lane) ?? null) : null);
  timeline.forEach((item, index) => {
    const key = `${index}`;
    switch (item.kind) {
      case "state": {
        for (const lane of lanes.values()) lane.open = false;
        lanes.clear();
        if (PHASES.has(item.to)) {
          const after = AFTER[item.reason] ?? null;
          if (after) round++;
          step = { kind: "chef", key, at: item.at, icon: ICON[item.to] ?? "code", tone: "ok", text: "", detail: "", tech: [], mark: {}, role: null, phase: item.to, said: "", last: "", after, round };
          steps.push(step);
          list.push(step);
        } else if (item.to === "dropped") {
          list.push({ kind: "chef", key, at: item.at, icon: "stop", tone: "idle", text: item.reason ? `Stopped: ${item.reason}` : "Stopped", detail: "", tech: [], mark: {} });
          step = null;
        } else step = null;
        return;
      }
      case "held":
        if (item.by) list.push({ kind: "chef", key, at: item.at, icon: "pick", tone: "idle", text: `Waiting for hotfix ${item.by} to be merged first`, detail: "", tech: [`held by hotfix ${item.by}`], mark: {} });
        return;
      case "agent":
        if (item.lane) {
          const lane: Step = { kind: "chef", key, at: item.at, icon: "code", tone: "ok", text: "", detail: "", tech: [`${item.role} started on ${item.model} in lane/${item.lane}`], mark: {}, role: item.role, phase: "coding", said: "", last: "", after: null, round: 1, lane: item.lane, open: true };
          lanes.set(item.lane, lane);
          steps.push(lane);
          list.push(lane);
          return;
        }
        if (step) step.role = item.role;
        tech(`${item.role} started on ${item.model}`);
        return;
      case "text": {
        const lane = laneOf(item);
        if (lane) lane.said = item.text;
        else if (step && !item.lane) step.said = item.text;
        return;
      }
      case "tool": {
        const lane = laneOf(item);
        const target = lane ?? (item.lane ? null : step);
        target?.tech.push(toolText(item.tool, item.detail));
        if (target) target.last = toolText(item.tool, item.detail);
        return;
      }
      case "lanes":
        list.push({ kind: "chef", key, at: item.at, icon: "code", tone: "ok", text: `${item.lanes.length} roles work at the same time, each on its own branch`, detail: "", tech: item.lanes.map((l) => `${l.branch}: ${l.items} ${l.items === 1 ? "step" : "steps"}`), mark: {} });
        return;
      case "lane": {
        const lane = lanes.get(item.role);
        if (lane && (item.status === "committed" || item.status === "unchanged" || item.status === "rejected")) {
          lane.open = false;
          lane.outcome = item.status;
        }
        if (item.status === "conflict") list.push({ kind: "chef", key, at: item.at, icon: "sync", tone: "bad", text: `Two roles changed the same lines in ${item.paths.join(", ")}, so the conflict fixer merges them`, detail: "", tech: [`merged ${item.branch} with conflicts${item.commitId ? ` as ${short(item.commitId)}` : ""}`], mark: {} });
        else if (item.status === "merged") tech(`merged ${item.branch} into the feature${item.commitId ? ` as ${short(item.commitId)}` : ""}`);
        return;
      }
      case "error":
        tech(`error: ${item.message}`);
        return;
      case "commit": {
        const line = `commit ${short(item.commitId)} by ${item.role}: ${item.message.split("\n")[0] ?? ""}`;
        const lane = laneOf(item);
        if (lane) {
          lane.tech.push(line);
          return;
        }
        if (step && !step.role && item.role !== "sync" && item.role !== "chef") step.role = item.role;
        tech(line);
        return;
      }
      case "app":
        tech(item.status === "starting" ? `app starting from ${short(item.commitId)}` : item.status === "running" ? `app running at ${short(item.commitId)}` : item.status === "no-stack" ? `no wrangler config or compose file at ${short(item.commitId)}, so the app cannot start` : `app could not start at ${short(item.commitId)}${item.error ? `: ${item.error}` : ""}`);
        return;
      case "rejected": {
        const line = `rule ${item.rule} blocked a ${item.role} change to ${item.paths.join(", ")}`;
        const lane = laneOf(item);
        if (lane) lane.tech.push(line);
        else tech(line);
        return;
      }
      case "recalled":
        tech(`recalled ${item.paths.join(", ")}`);
        return;
      case "sync":
        if (item.conflict) list.push({ kind: "chef", key, at: item.at, icon: "sync", tone: "bad", text: `The latest app changed the same files: ${item.paths.join(", ")}`, detail: "", tech: [`main ${short(item.mainCommit)}`], mark: {} });
        else tech(`pulled main ${short(item.mainCommit)}`);
        return;
      case "review":
        list.push({
          kind: "chef",
          key,
          at: item.at,
          icon: "review",
          tone: item.approve ? "ok" : "bad",
          text: item.approve ? "A reviewer approved the change" : `A reviewer asked for changes: ${item.reasons[0] ?? "no reason given"}`,
          detail: "",
          tech: [...item.reasons, `reviewer ${item.model}`],
          mark: { review: item.approve ? "approved" : "rejected" },
          role: "reviewer",
        });
        return;
      case "gate": {
        const failed = item.checks.filter((c) => !c.ok);
        list.push({
          kind: "chef",
          key,
          at: item.at,
          icon: "check",
          tone: item.ok ? "ok" : "bad",
          text: item.ok ? `Passed all ${item.checks.length} checks` : `${failed.length} of ${item.checks.length} checks failed: ${failed.map((c) => c.name).join(", ")}`,
          detail: "",
          tech: item.checks.map((c) => `${c.ok ? "passed" : "failed"} ${c.name}`),
          mark: { gate: item.ok ? "passed" : "failed" },
        });
        return;
      }
      case "merged":
        list.push(item.into ? { kind: "chef", key, at: item.at, icon: "sync", tone: "ok", text: "Done, merged into its parent feature", detail: "", tech: [`merged into ${item.into} as ${short(item.commitId)}`], mark: {} } : { kind: "chef", key, at: item.at, icon: "merged", tone: "ok", text: "Merged into main", detail: "", tech: [`merged into main as ${short(item.commitId)}`], mark: {} });
        step = null;
        return;
      case "stuck":
        list.push({ kind: "chef", key, at: item.at, icon: "alert", tone: "bad", text: `Stopped: ${plainReason(item.reason)}`, detail: "", tech: [item.reason], mark: {} });
        step = null;
        return;
      case "steered":
        list.push({ kind: "you", key, at: item.at, text: item.message, note: true });
        return;
      case "picked":
        list.push({
          kind: "chef",
          key,
          at: item.at,
          icon: "pick",
          tone: item.won ? "ok" : "idle",
          text: item.won ? "This attempt was picked over the others" : "Another attempt was picked instead",
          detail: "",
          tech: [...item.reasons, ...item.candidates.map((c) => `${short(c.sessionId, 9)} passed ${c.passed} of ${c.total}`)],
          mark: {},
        });
        return;
      default:
        return;
    }
  });
  const running = isActive(state);
  const open = steps.filter((s) => !s.lane).at(-1);
  for (const s of steps) {
    const current = running && (s.lane ? s.open === true : s === open);
    s.text = s.round > 1 ? `${headline(s, current)} (try ${s.round})` : headline(s, current);
    s.tone = current ? "run" : s.outcome === "rejected" ? "bad" : "ok";
    s.detail = current ? lastLine(s.said) || s.last : "";
  }
  const hidden = new Set<Update>(steps.filter((s) => (s.phase === "reviewing" || s.phase === "gating") && !(running && s === open)));
  return list.filter((u) => !hidden.has(u));
}

export function plainReason(reason: string): string {
  const tries = /^attempt budget exhausted \((\d+)\/\d+\)/.exec(reason);
  if (tries) return `Chef tried ${tries[1]} times and could not get past the review and checks.`;
  if (reason.startsWith("same failure repeated")) return "Chef hit the same failure again after changing its approach, so it stopped instead of spending more tokens on it.";
  return reason;
}

export function whatFailed(input: { readonly feedback?: string | null | undefined; readonly history?: readonly string[] | undefined; readonly verdict?: { readonly approve: boolean; readonly reasons: readonly string[] } | null | undefined }): string | null {
  const saved = input.feedback?.trim() || input.history?.findLast((entry) => entry.trim())?.trim();
  if (saved) return saved;
  if (input.verdict && !input.verdict.approve && input.verdict.reasons.length) return `Reviewer rejected the change:\n${input.verdict.reasons.map((r) => `- ${r}`).join("\n")}`;
  return null;
}

export function stripFeatureTag(prompt: string): { readonly text: string; readonly feature: string | null } {
  const match = /^#([a-z0-9-]+)\s+([\s\S]*)$/.exec(prompt.trim());
  return match ? { text: match[2] as string, feature: match[1] as string } : { text: prompt, feature: null };
}

export type Command = "chore" | "hotfix" | "new" | "map";

export function splitCommands(prompt: string): { readonly commands: readonly Command[]; readonly text: string } {
  const commands: Command[] = [];
  let text = prompt.trim();
  for (let match = /^\/(chore|hotfix|new|map)\b\s*/i.exec(text); match; match = /^\/(chore|hotfix|new|map)\b\s*/i.exec(text)) {
    commands.push((match[1] as string).toLowerCase() as Command);
    text = text.slice(match[0].length);
  }
  return { commands, text: commands.length ? text : prompt };
}

export function activity(state: SessionState, timeline: readonly TimelineItem[], stuck: string | null): string {
  if (state === "merged") return timeline.some((item) => item.kind === "merged" && item.into) ? "Passed every check and merged into its parent feature" : "Passed every check and merged into main";
  if (state === "stuck") return stuck ? plainReason(stuck) : "Needs your help";
  if (state === "dropped") return "Stopped";
  const last = [...updates(timeline, state)].reverse().find((u) => u.kind === "chef");
  if (!last || last.kind !== "chef") return NOW[state];
  return last.detail ? `${last.text}: ${last.detail}` : last.text;
}
