import { AlertTriangle, GitCommitHorizontal, Lightbulb, Loader2, Rocket, Undo2, Wifi, WifiOff } from "lucide-react";
import { BarSkeleton } from "@/components/loading";
import { ago, short } from "@/lib/format";
import { useNow } from "@/lib/live";
import { groupSessions } from "@/lib/model";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const STARTING_MS = 5 * 60_000;

const CONNECTION = {
  live: { label: "Live updates", icon: Wifi, tone: "text-muted-foreground" },
  polling: { label: "Updating every few seconds", icon: Wifi, tone: "text-muted-foreground" },
  connecting: { label: "Connecting", icon: Loader2, tone: "text-muted-foreground" },
  offline: { label: "Offline", icon: WifiOff, tone: "text-bad" },
} as const;

function Chip({ children, onClick, tone, label, id }: { readonly children: React.ReactNode; readonly onClick?: () => void; readonly tone?: string | undefined; readonly label: string; readonly id?: string }) {
  const className = cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap text-muted-foreground", onClick && "hover:bg-muted hover:text-foreground", tone);
  return onClick ? (
    <button type="button" onClick={onClick} className={className} title={label} data-chip={id}>
      {children}
    </button>
  ) : (
    <span className={className} title={label} data-chip={id}>
      {children}
    </span>
  );
}

function StatusChips() {
  const { data, sessions, features, openSession } = useWorkspace();
  const now = useNow(5000);
  const groups = groupSessions(sessions);
  const stuck = groups["needs-you"];
  const working = groups.working;
  const starting = data.live.routes.filter((r) => r.decision.intent !== "question" && now - r.at < STARTING_MS && !sessions.some((s) => s.createdAt >= r.at)).length;
  const live = features.filter((f) => f.spec?.status === "merged" || f.sessions.some((s) => s.state === "merged")).length;
  const lastMerge = data.live.merges.at(-1);
  const reverts = data.live.reverts.length;
  const external = data.live.external;
  return (
    <>
      {stuck.length ? (
        <Chip id="needs-you" label="Builds that stopped and wait for you" tone="font-medium text-bad hover:text-bad" onClick={() => openSession(stuck[0]?.id ?? "")}>
          <AlertTriangle className="size-3.5" />
          {stuck.length} {stuck.length === 1 ? "needs" : "need"} you
        </Chip>
      ) : null}
      <Chip id="working" label="Builds running now" tone={working.length || starting ? "text-run" : undefined} {...(working.length ? { onClick: () => openSession(working[0]?.id ?? "") } : {})}>
        {working.length || starting ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-2 rounded-full border border-muted-foreground" />}
        {[working.length ? `${working.length} working` : "", starting ? "getting a new build ready" : ""].filter(Boolean).join(", ") || "Nothing running"}
      </Chip>
      <Chip id="live" label="Features live in the app">
        <Rocket className="size-3.5 text-ok" />
        {live} live
      </Chip>
      <Chip id="main" label={lastMerge ? `The live app is at commit ${data.spec?.commitId ?? lastMerge.commitId}` : "The live app"}>
        <GitCommitHorizontal className="size-3.5" />
        <span>
          App <span className="font-mono">{short(data.spec?.commitId ?? lastMerge?.commitId) || "not created"}</span>
          {lastMerge ? ` · updated ${ago(lastMerge.at, now)}` : ""}
        </span>
      </Chip>
      {reverts ? (
        <Chip id="reverts" label="Changes chef took back because the live app broke" tone="text-bad">
          <Undo2 className="size-3.5" />
          {reverts} taken back
        </Chip>
      ) : null}
      {external ? (
        <Chip id="sync" label={`Repository sync: ${external.summary}`} tone={external.type === "external.conflict" || external.type === "external.stuck" ? "text-bad" : undefined}>
          Repo {external.type.replace("external.", "").replace("-", " ")} {ago(external.at, now)}
        </Chip>
      ) : null}
    </>
  );
}

export function ProjectBar() {
  const { data, select } = useWorkspace();
  const learned = data.live.lessons.length + data.live.rules.length;
  const connection = CONNECTION[data.connection];
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2 sm:px-3" id="project-bar" aria-label="Project status">
      {data.ready ? <StatusChips /> : <BarSkeleton />}
      <span className="flex-1" />
      <Chip id="memory" label="Lessons and rules chef learned in this project" onClick={() => select({ view: "insights", feature: null, session: null, panel: null })}>
        <Lightbulb className="size-3.5" />
        {learned ? `${learned} learned` : "Memory"}
      </Chip>
      <Chip id="connection" label={connection.label} tone={connection.tone}>
        <connection.icon className={cn("size-3.5", data.connection === "connecting" && "animate-spin")} />
        <span className="max-sm:sr-only">{connection.label}</span>
      </Chip>
    </div>
  );
}
