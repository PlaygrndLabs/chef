import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChefEvent, SessionRecord } from "@chef/core";
import { isCaughtUp } from "@chef/core/replay";
import { projectApi, type ProjectSpec } from "./api";
import { apply, emptyProject, type LogEntry, type ProjectLive } from "./events";

const EVENT_PAGE = 500;
const PAGES_PER_POLL = 20;
const POLL_MS = 2500;
const REFRESH_DEBOUNCE_MS = 600;
const REPLAY_WAIT_MS = 4000;
const NO_RECORDS: readonly SessionRecord[] = [];

export type Connection = "connecting" | "live" | "polling" | "offline";

const REFRESH_RECORDS: ReadonlySet<ChefEvent["type"]> = new Set(["session.created", "session.state", "session.stuck", "session.needs", "session.budget", "main.merged", "branch.merged", "main.reverted", "commit.created", "sync.merged", "attempt.picked", "features.removed"]);
const REFRESH_SPEC: ReadonlySet<ChefEvent["type"]> = new Set(["main.merged", "main.reverted", "live.updated", "feature.arranged", "features.removed"]);

export class Store {
  state: ProjectLive = emptyProject();
  version = 0;
  private readonly listeners = new Set<() => void>();
  private frame: number | null = null;
  private held = true;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.version;

  receive(entries: readonly LogEntry[]): ChefEvent[] {
    const applied: ChefEvent[] = [];
    for (const entry of entries) if (apply(this.state, entry)) applied.push(entry.event);
    if (applied.length) this.schedule();
    return applied;
  }

  flush() {
    this.held = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private schedule() {
    if (this.held || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => this.flush());
  }
}

export interface FeedOptions {
  readonly project: string;
  readonly store: Store;
  readonly onEvents: (events: readonly ChefEvent[]) => void;
  readonly onConnection: (connection: Connection) => void;
  readonly onCaughtUp: () => void;
}

export function connectFeed({ project, store, onEvents, onConnection, onCaughtUp }: FeedOptions): () => void {
  let closed = false;
  let caughtUp = false;
  let socket: WebSocket | null = null;
  let poller: number | undefined;
  let replayWait: number | undefined;
  let polling = false;
  let again = false;
  let live = false;

  const markCaughtUp = () => {
    if (closed || caughtUp) return;
    caughtUp = true;
    window.clearTimeout(replayWait);
    store.flush();
    onCaughtUp();
  };

  const catchUp = async () => {
    for (let page = 0; page < PAGES_PER_POLL && !closed; page++) {
      const response = await fetch(`/api/projects/${project}/events?after=${store.state.lastSeq}`);
      if (!response.ok) throw new Error(String(response.status));
      const entries = (await response.json()) as LogEntry[];
      onEvents(store.receive(entries));
      if (entries.length < EVENT_PAGE) break;
    }
    markCaughtUp();
  };

  const poll = async (): Promise<void> => {
    if (polling) {
      again = true;
      return;
    }
    polling = true;
    try {
      await catchUp();
      if (!closed) onConnection(live ? "live" : "polling");
    } catch {
      if (!closed) onConnection("offline");
    } finally {
      polling = false;
      if (again && !closed) {
        again = false;
        void poll();
      }
    }
  };

  const startPolling = () => {
    if (closed || poller !== undefined) return;
    void poll();
    poller = window.setInterval(poll, POLL_MS);
  };

  const openSocket = () => {
    if (closed) return;
    try {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${location.host}/agents/project/${project}?after=${store.state.lastSeq}`);
    } catch {
      startPolling();
      return;
    }
    socket.addEventListener("open", () => {
      live = true;
      onConnection("live");
      if (!caughtUp) replayWait = window.setTimeout(() => void poll(), REPLAY_WAIT_MS);
    });
    socket.addEventListener("message", (message) => {
      try {
        const data: unknown = JSON.parse(String(message.data));
        if (isCaughtUp(data)) {
          if (data.caughtUp > store.state.lastSeq) void poll();
          else markCaughtUp();
          return;
        }
        const entry = data as LogEntry;
        if (typeof entry?.seq !== "number") return;
        if (entry.seq > store.state.lastSeq + 1) void poll();
        else onEvents(store.receive([entry]));
      } catch {
        return;
      }
    });
    const fallBack = () => {
      live = false;
      startPolling();
    };
    socket.addEventListener("close", fallBack);
    socket.addEventListener("error", fallBack);
  };

  openSocket();

  return () => {
    closed = true;
    socket?.close();
    window.clearInterval(poller);
    window.clearTimeout(replayWait);
  };
}

export interface ProjectData {
  readonly live: ProjectLive;
  readonly version: number;
  readonly ready: boolean;
  readonly connection: Connection;
  readonly spec: ProjectSpec | null;
  readonly records: readonly SessionRecord[];
  readonly refresh: () => void;
}

export function useProject(project: string): ProjectData {
  const store = useMemo(() => new Store(), [project]);
  const version = useSyncExternalStore(store.subscribe, store.snapshot);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [caughtUp, setCaughtUp] = useState(false);
  const [spec, setSpec] = useState<ProjectData["spec"]>(null);
  const [records, setRecords] = useState<readonly SessionRecord[] | null>(null);
  const timers = useRef<{ records?: number; spec?: number }>({});
  const api = useMemo(() => projectApi(project), [project]);

  const loadRecords = useCallback(() => {
    api.sessions().then(setRecords, () => setRecords((current) => current ?? []));
  }, [api]);
  const loadSpec = useCallback(() => {
    api.spec().then(setSpec, () => setSpec((current) => current ?? { commitId: null, features: [] }));
  }, [api]);

  const refresh = useCallback(() => {
    loadRecords();
    loadSpec();
  }, [loadRecords, loadSpec]);

  useEffect(() => {
    const pending = timers.current;
    const debounced = (key: "records" | "spec", run: () => void) => {
      window.clearTimeout(pending[key]);
      pending[key] = window.setTimeout(run, REFRESH_DEBOUNCE_MS);
    };
    refresh();
    const disconnect = connectFeed({
      project,
      store,
      onConnection: setConnection,
      onCaughtUp: () => setCaughtUp(true),
      onEvents: (events) => {
        if (events.some((e) => REFRESH_RECORDS.has(e.type))) debounced("records", loadRecords);
        if (events.some((e) => REFRESH_SPEC.has(e.type))) debounced("spec", loadSpec);
      },
    });
    return () => {
      disconnect();
      window.clearTimeout(pending.records);
      window.clearTimeout(pending.spec);
    };
  }, [project, store, refresh, loadRecords, loadSpec]);

  const ready = caughtUp && spec !== null && records !== null;
  return useMemo(() => ({ live: store.state, version, ready, connection, spec, records: records ?? NO_RECORDS, refresh }), [store, version, ready, connection, spec, records, refresh]);
}

export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
