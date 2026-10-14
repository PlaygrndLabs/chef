import type { PreviewDeployment, PreviewHost } from "../ports/preview-host.ts";
import type { RepoHost } from "../ports/repo-host.ts";
import type { Clock, KeyValueStore } from "../ports/runtime.ts";

export interface PreviewSpace {
  remove(branches: readonly string[]): Promise<void>;
}

export interface PreviewEntry extends PreviewDeployment {
  readonly branch: string;
  readonly at: number;
}

interface SpaceState {
  readonly live: boolean;
  readonly lastActivity: number;
}

interface Building {
  readonly since: number;
  readonly error: string | null;
}

export type PreviewVisit =
  | { readonly status: "ready"; readonly url: string; readonly commitId: string }
  | { readonly status: "building"; readonly since: number }
  | { readonly status: "failed"; readonly error: string }
  | { readonly status: "rebuild" }
  | { readonly status: "missing" };

export type SweepOutcome = { readonly status: "asleep" } | { readonly status: "busy" } | { readonly status: "awake"; readonly idleForMs: number } | { readonly status: "removed"; readonly previews: number };

export const DEFAULT_PREVIEW_IDLE_MINUTES = 60;

const BUILD_STALE_MS = 15 * 60_000;
const SPACE = "previews/space";
const ENTRY = "previews/entry/";
const BUILDING = "previews/building/";

export function previewBranch(key: string): string {
  return `preview/${key}`;
}

export function previewName(branch: string, worker = ""): string {
  const max = Math.max(1, Math.min(30, 62 - worker.length));
  return branch.replace(/^preview\//, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "") || "preview";
}

export class PreviewKeeper implements PreviewHost {
  constructor(
    private readonly host: PreviewHost,
    private readonly space: PreviewSpace,
    private readonly deps: { readonly repos: RepoHost; readonly store: KeyValueStore; readonly clock: Clock; readonly canonical: string; readonly onActivity?: () => void; readonly gated?: boolean },
  ) {}

  async deploy(input: { repo: string; branch: string; commitId: string }): Promise<PreviewDeployment> {
    const deployment = await this.host.deploy(input);
    const now = this.deps.clock.now();
    await this.deps.store.put<PreviewEntry>(`${ENTRY}${input.branch}`, { ...deployment, branch: input.branch, at: now });
    await this.touch(true);
    return deployment;
  }

  async current(input: { repo: string; branch: string }): Promise<PreviewDeployment | null> {
    const state = await this.state();
    if (!state.live) return null;
    return (await this.deps.store.get<PreviewEntry | null>(`${ENTRY}${input.branch}`)) ?? null;
  }

  async visit(key: string): Promise<PreviewVisit> {
    const branch = previewBranch(key);
    const state = await this.state();
    await this.touch(state.live);
    const entry = state.live ? await this.deps.store.get<PreviewEntry | null>(`${ENTRY}${branch}`) : null;
    if (entry && (entry.gated || !this.deps.gated)) return { status: "ready", url: entry.url, commitId: entry.commitId };
    const building = await this.deps.store.get<Building | null>(`${BUILDING}${branch}`);
    const now = this.deps.clock.now();
    if (building && !building.error && now - building.since < BUILD_STALE_MS) return { status: "building", since: building.since };
    if (building?.error) return { status: "failed", error: building.error };
    const head = entry ? true : await this.deps.repos.resolveRef(this.deps.canonical, branch);
    return head ? { status: "rebuild" } : { status: "missing" };
  }

  async startRebuild(key: string): Promise<void> {
    await this.deps.store.put<Building>(`${BUILDING}${previewBranch(key)}`, { since: this.deps.clock.now(), error: null });
  }

  async rebuild(key: string): Promise<PreviewVisit> {
    const branch = previewBranch(key);
    const commitId = await this.deps.repos.resolveRef(this.deps.canonical, branch);
    if (!commitId) {
      await this.deps.store.put(`${BUILDING}${branch}`, null);
      return { status: "missing" };
    }
    try {
      const deployment = await this.deploy({ repo: this.deps.canonical, branch, commitId });
      await this.deps.store.put(`${BUILDING}${branch}`, null);
      return { status: "ready", url: deployment.url, commitId };
    } catch (error) {
      const message = (error as Error).message;
      await this.deps.store.put<Building>(`${BUILDING}${branch}`, { since: this.deps.clock.now(), error: message });
      return { status: "failed", error: message };
    }
  }

  async sweep(input: { readonly busy: boolean; readonly idleMs: number }): Promise<SweepOutcome> {
    const state = await this.state();
    if (!state.live) return { status: "asleep" };
    if (input.busy) return { status: "busy" };
    const idleForMs = this.deps.clock.now() - state.lastActivity;
    if (idleForMs < input.idleMs) return { status: "awake", idleForMs };
    const entries = await this.deps.store.list<PreviewEntry | null>(ENTRY);
    const removed = [...entries.values()].filter((entry): entry is PreviewEntry => entry !== null);
    await this.space.remove(removed.map((entry) => entry.branch));
    for (const key of entries.keys()) await this.deps.store.put(key, null);
    await this.deps.store.put<SpaceState>(SPACE, { live: false, lastActivity: state.lastActivity });
    return { status: "removed", previews: removed.length };
  }

  async liveBranches(): Promise<string[]> {
    if (!(await this.state()).live) return [];
    const entries = await this.deps.store.list<PreviewEntry | null>(ENTRY);
    return [...entries.values()].filter((entry): entry is PreviewEntry => entry !== null).map((entry) => entry.branch);
  }

  async live(): Promise<boolean> {
    return (await this.state()).live;
  }

  private async state(): Promise<SpaceState> {
    return (await this.deps.store.get<SpaceState>(SPACE)) ?? { live: true, lastActivity: 0 };
  }

  private async touch(live: boolean): Promise<void> {
    await this.deps.store.put<SpaceState>(SPACE, { live, lastActivity: this.deps.clock.now() });
    this.deps.onActivity?.();
  }
}
