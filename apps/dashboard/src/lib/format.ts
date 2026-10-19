import type { AppStatus, SessionState } from "@chef/core";

export const short = (id: string | null | undefined, length = 7) => (id ? id.slice(0, length) : "");

export function ago(at: number | null | undefined, now = Date.now()): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString();
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function duration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return `${Math.max(0, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export type Tone = "run" | "ok" | "bad" | "idle" | "gone";

export const STATE_LABEL: Readonly<Record<SessionState, string>> = {
  queued: "Queued",
  planning: "Planning",
  testing: "Writing tests",
  coding: "Coding",
  reviewing: "Reviewing",
  gating: "Gating",
  merged: "Merged",
  stuck: "Stuck",
  dropped: "Dropped",
};

export const PLAIN_STATE: Readonly<Record<SessionState, string>> = {
  queued: "Waiting",
  planning: "Planning",
  testing: "Writing tests",
  coding: "Writing code",
  reviewing: "In review",
  gating: "Final checks",
  merged: "Merged",
  stuck: "Needs you",
  dropped: "Stopped",
};

export function stateTone(state: SessionState): Tone {
  if (state === "merged") return "ok";
  if (state === "stuck") return "bad";
  if (state === "dropped") return "gone";
  if (state === "queued") return "idle";
  return "run";
}

export const STEPS = [
  { key: "route", label: "Route" },
  { key: "planning", label: "Plan" },
  { key: "testing", label: "Tests" },
  { key: "coding", label: "Code" },
  { key: "reviewing", label: "Review" },
  { key: "gating", label: "Gate" },
  { key: "merged", label: "Merge" },
] as const;

const STEP_INDEX: Readonly<Record<string, number>> = { queued: 0, planning: 1, testing: 2, coding: 3, reviewing: 4, gating: 5, merged: 6 };

export function stepIndex(state: SessionState): number {
  return STEP_INDEX[state] ?? 0;
}

export function appHost(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export const APP_STATUS_LABEL: Readonly<Record<AppStatus, string>> = {
  starting: "Starting",
  running: "Running",
  failed: "Could not start",
  "no-stack": "No app to run",
};

export const APP_TONE: Readonly<Record<AppStatus, Tone>> = { starting: "run", running: "ok", failed: "bad", "no-stack": "idle" };
