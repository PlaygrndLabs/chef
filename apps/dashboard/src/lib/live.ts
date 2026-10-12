import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FeatureSpec, ChefEvent, SessionRecord } from "@chef/core";
import { projectApi } from "./api";
import { apply, emptyProject, type LogEntry, type ProjectLive } from "./events";

export type Connection = "connecting" | "live" | "polling" | "offline";

const REFRESH_RECORDS: ReadonlySet<ChefEvent["type"]> = new Set(["session.created", "session.state", "session.stuck", "main.merged", "main.reverted", "commit.created", "sync.merged", "attempt.picked"]);
const REFRESH_SPEC: ReadonlySet<ChefEvent["type"]> = new Set(["main.merged", "main.reverted"]);

class Store {
  state: ProjectLive = emptyProject();
  version = 0;
  private readonly listeners = new Set<() => void>();
  private pending = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.version;

  receive(entries: readonly LogEntry[]): ChefEvent[] {
    const applied: ChefEvent[] = [];
    for (const entry of entries) if (apply(this.state, entry)) applied.push(entry.event);
    if (applied.length) this.notify();
    return applied;
  }

  reset() {
    this.state = emptyProject();
    this.notify();
  }

  private notify() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.version++;
      for (const listener of this.listeners) listener();
    });
  }
}

export interface ProjectData {
  readonly live: ProjectLive;
  readonly version: number;
  readonly connection: Connection;
  readonly spec: { readonly commitId: string | null; readonly features: readonly FeatureSpec[] } | null;
  readonly records: readonly SessionRecord[];
  readonly refresh: () => void;
}

export function useProject(project: string): ProjectData {
  const store = useMemo(() => new Store(), [project]);
  const version = useSyncExternalStore(store.subscribe, store.snapshot);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [spec, setSpec] = useState<ProjectData["spec"]>(null);
  const [records, setRecords] = useState<readonly SessionRecord[]>([]);
  const timers = useRef<{ records?: number; spec?: number }>({});
  const api = useMemo(() => projectApi(project), [project]);

  const loadRecords = useCallback(() => {
    api.sessions().then(setRecords, () => undefined);
  }, [api]);
  const loadSpec = useCallback(() => {
    api.spec().then(setSpec, () => setSpec({ commitId: null, features: [] }));
  }, [api]);

  const refresh = useCallback(() => {
    loadRecords();
    loadSpec();
  }, [loadRecords, loadSpec]);

  useEffect(() => {
    const debounced = (key: "records" | "spec", run: () => void) => {
      window.clearTimeout(timers.current[key]);
      timers.current[key] = window.setTimeout(run, 600);
    };
    const onEvents = (events: readonly ChefEvent[]) => {
      if (events.some((e) => REFRESH_RECORDS.has(e.type))) debounced("records", loadRecords);
      if (events.some((e) => REFRESH_SPEC.has(e.type))) debounced("spec", loadSpec);
    };
    let closed = false;
    let socket: WebSocket | null = null;
    let poller: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${project}/events?after=${store.state.lastSeq}`);
        if (!response.ok) throw new Error(String(response.status));
        onEvents(store.receive((await response.json()) as LogEntry[]));
        setConnection("polling");
      } catch {
        setConnection("offline");
      }
    };
    const startPolling = () => {
      if (closed || poller !== undefined) return;
      void poll();
      poller = window.setInterval(poll, 2500);
    };
    try {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${location.host}/agents/project-agent/${project}`);
      socket.addEventListener("open", () => setConnection("live"));
      socket.addEventListener("message", (message) => {
        try {
          const entry = JSON.parse(String(message.data)) as LogEntry;
          onEvents(store.receive([entry]));
        } catch {
          return;
        }
      });
      socket.addEventListener("close", startPolling);
      socket.addEventListener("error", startPolling);
    } catch {
      startPolling();
    }
    refresh();
    return () => {
      closed = true;
      socket?.close();
      window.clearInterval(poller);
      window.clearTimeout(timers.current.records);
      window.clearTimeout(timers.current.spec);
    };
  }, [project, store, refresh, loadRecords, loadSpec]);

  return { live: store.state, version, connection, spec, records, refresh };
}

export function useNow(intervalMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
