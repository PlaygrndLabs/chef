import { AlertTriangle, AppWindowMac, ExternalLink, GitCommitHorizontal, GitMerge, Loader2, Undo2, Wifi, WifiOff } from "lucide-react";
import { BarSkeleton } from "@/components/loading";
import { appLink, MAIN_APP, NO_STACK } from "@/lib/app-view";
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
  const className = cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap text-muted-foreground", onClick && "hover:bg-muted hover:text-foreground", tone);
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
  const merged = features.filter((f) => f.spec?.status === "merged" || f.sessions.some((s) => s.state === "merged")).length;
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
        {working.length || starting ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-2 border border-muted-foreground" />}
        {[working.length ? `${working.length} working` : "", starting ? "getting a new build ready" : ""].filter(Boolean).join(", ") || "Nothing running"}
      </Chip>
      <Chip id="merged" label="Features merged into main">
        <GitMerge className="size-3.5 text-ok" />
        {merged} merged
      </Chip>
      <MainAppChip now={now} />
      {reverts ? (
        <Chip id="reverts" label="Changes Chef took back because they broke main" tone="text-bad">
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

function MainAppChip({ now }: { readonly now: number }) {
  const { data, api, selection } = useWorkspace();
  const app = data.spec?.mainApp ?? null;
  const lastMerge = data.live.merges.at(-1);
  if (app?.status === "starting") {
    return (
      <Chip id="main-app" label={`Starting main's app, the release candidate, at commit ${short(app.commitId)}`} tone="text-run">
        <Loader2 className="size-3.5 animate-spin" />
        Starting main's app
      </Chip>
    );
  }
  if (app?.status === "failed") {
    return (
      <Chip id="main-app" label={`Main's app could not start: ${app.error ?? "unknown error"}. Click to try again.`} tone="text-bad hover:text-bad" onClick={() => void api.restartMainApp().catch(() => undefined)}>
        <AlertTriangle className="size-3.5" />
        Main's app did not start · try again
      </Chip>
    );
  }
  if (app?.status === "no-stack") {
    return (
      <Chip id="main-app" label={NO_STACK} tone="text-bad">
        <AlertTriangle className="size-3.5" />
        Main has no compose file
      </Chip>
    );
  }
  if (app?.status === "running") {
    return (
      <a href={appLink(selection.project, MAIN_APP)} target="_blank" rel="noreferrer" data-chip="main-app" title={`Open main's app, the release candidate, at commit ${short(app.commitId)}, started ${ago(app.at, now)}`} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground">
        <AppWindowMac className="size-3.5" />
        <span>Open main's app</span>
        <ExternalLink className="size-3" />
      </a>
    );
  }
  return (
    <Chip id="main" label={lastMerge ? `Main is at commit ${data.spec?.commitId ?? lastMerge.commitId}` : "Main"}>
      <GitCommitHorizontal className="size-3.5" />
      <span>
        Main <span className="font-mono">{short(data.spec?.commitId ?? lastMerge?.commitId) || "not created"}</span>
        {lastMerge ? ` · updated ${ago(lastMerge.at, now)}` : ""}
      </span>
    </Chip>
  );
}

export function ProjectBar() {
  const { data } = useWorkspace();
  const connection = CONNECTION[data.connection];
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto dash-t bg-sidebar px-1.5 font-mono" id="project-bar" aria-label="Project status">
      {data.ready ? <StatusChips /> : <BarSkeleton />}
      <span className="flex-1" />
      <Chip id="connection" label={connection.label} tone={connection.tone}>
        <connection.icon className={cn("size-3.5", data.connection === "connecting" && "animate-spin")} />
        <span className="max-sm:sr-only">{connection.label}</span>
      </Chip>
    </div>
  );
}
