import { useState } from "react";
import { Check, ChevronDown, Cloud, Copy, ExternalLink, RotateCw } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status";
import type { CloudflareFact, CloudflareKind, CloudflareResource, CloudflareView } from "@chef/core";
import { roleLabel, useAgents } from "@/lib/agents";
import { appLink, MAIN_APP } from "@/lib/app-view";
import { cost, duration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const KIND: Readonly<Record<CloudflareKind, string>> = {
  repo: "Artifacts",
  branch: "Artifacts",
  container: "Container",
  app: "Container",
  worker: "Workers",
  "durable-object": "Durable Objects",
  workflow: "Workflows",
  vectorize: "Vectorize",
};

function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch {
      toast.error("Could not copy it");
    }
  };
  return (
    <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`} title={`Copy ${label}`} className="shrink-0 text-muted-foreground hover:text-foreground">
      {done ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
    </button>
  );
}

const prose = (fact: CloudflareFact) => !fact.copy && !fact.href && fact.value.length > 28 && / [a-z]+ /.test(fact.value);

function Fact({ fact, app }: { readonly fact: CloudflareFact; readonly app: string | null }) {
  const href = fact.href ? (app ?? fact.href) : null;
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{fact.label}</dt>
      <dd className="flex min-w-0 items-start gap-1.5">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono underline-offset-2 hover:underline">
            {fact.value}
          </a>
        ) : prose(fact) ? (
          <span className="min-w-0">{fact.value}</span>
        ) : (
          <span className="min-w-0 truncate font-mono" title={fact.value}>
            {fact.value}
          </span>
        )}
        {fact.copy ? <CopyButton value={fact.value} label={fact.label.toLowerCase()} /> : null}
      </dd>
    </div>
  );
}

function UsedBy({ roles }: { readonly roles: readonly string[] }) {
  const { select, selection } = useWorkspace();
  const view = useAgents(selection.project);
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-cf-used-by>
      <span className="mr-1 text-muted-foreground">Used by</span>
      {roles.map((role) => (
        <button
          key={role}
          type="button"
          onClick={() => select({ panel: "messages", role })}
          title={`See what ${roleLabel(role, view)} did`}
          aria-pressed={selection.role === role}
          className={cn("h-5 border px-1.5 hover:bg-muted", selection.role === role && "border-brand text-brand")}
          data-cf-agent={role}
        >
          {roleLabel(role, view)}
        </button>
      ))}
    </div>
  );
}

function RestartSandbox({ session, main }: { readonly session: string; readonly main: boolean }) {
  const { api } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const restart = async (now: boolean) => {
    setBusy(true);
    try {
      const { outcome } = await api.restartSandbox(session, { main, now });
      if (outcome === "waiting") toast("It restarts once the roles' running turns finish", { action: { label: "Restart now", onClick: () => void restart(true) } });
      else if (outcome === "restarted") toast.success(now ? "Restarted. Running turns continue where they stopped" : "Restarted. It starts again when it is next needed");
      else toast("It is already stopped");
    } catch (error) {
      toast.error(`Could not restart it: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" disabled={busy} onClick={() => void restart(false)} title="Restart this sandbox once its running turns finish" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50" data-cf-restart>
      <RotateCw className={cn("size-3", busy && "animate-spin")} />
      Restart
    </button>
  );
}

const PRICE: Readonly<Partial<Record<CloudflareKind, string>>> = {
  repo: "Artifacts: 10,000 operations and 1 GB a month come with Workers Paid, then $0.15 per 1,000 operations and $0.50 per GB-month",
  branch: "Part of its Artifacts repo",
  worker: "10 million requests a month come with Workers Paid, then $0.30 per million",
  "durable-object": "1 million requests and 400,000 GB-s a month come with Workers Paid",
  workflow: "Billed as Workers requests and CPU time",
  vectorize: "50 million queried and 10 million stored dimensions a month come with Workers Paid",
  app: "Runs in its sandbox, so its cost is the sandbox's",
};

function Resource({ resource, showRoles, session }: { readonly resource: CloudflareResource; readonly showRoles: boolean; readonly session: string | null }) {
  const { selection } = useWorkspace();
  const [open, setOpen] = useState(false);
  const id = resource.key === "main-app" ? MAIN_APP : session;
  const app = resource.kind === "app" && id ? appLink(selection.project, id) : null;
  const spent = resource.spent;
  const facts: readonly CloudflareFact[] = [
    { label: "Name", value: resource.name, copy: true },
    ...resource.facts,
    ...(spent ? [{ label: "Up so far", value: duration(spent.seconds * 1000) }, { label: "Cost so far", value: `${cost(spent.micros)}, memory and disk while it is up and CPU while it is busy, at Cloudflare's list price` }] : PRICE[resource.kind] ? [{ label: "Price", value: PRICE[resource.kind] as string }] : []),
  ];
  return (
    <li className="dash-b last:border-b-0" data-cf={resource.key} data-cf-kind={resource.kind} data-cf-roles={resource.roles.join(" ") || undefined}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex h-9 w-full min-w-0 items-center gap-2 px-1 text-left text-sm hover:bg-muted/60" data-cf-row>
          <Cloud className="size-3.5 shrink-0 text-brand" aria-label={`Cloudflare ${KIND[resource.kind]}`} data-cf-cloud />
          <span className="shrink-0">{resource.title}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={resource.name}>
            {resource.name}
          </span>
          {resource.state ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" data-cf-state={resource.state.tone} title={resource.state.text}>
              <StatusDot tone={resource.state.tone} />
              <span className="max-sm:sr-only">{resource.state.text}</span>
            </span>
          ) : null}
          {spent ? (
            <span className="w-14 shrink-0 text-right text-xs tabular-nums" data-cf-cost>
              {cost(spent.micros)}
            </span>
          ) : null}
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-1 pb-3 pl-6">
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <div className="contents">
              <dt className="text-muted-foreground">Product</dt>
              <dd>Cloudflare {KIND[resource.kind]}</dd>
            </div>
            {facts.map((fact) => (
              <Fact key={fact.label} fact={fact} app={app} />
            ))}
          </dl>
          {showRoles && resource.roles.length ? <UsedBy roles={resource.roles} /> : null}
          {resource.dashboard || (session && resource.kind === "container" && resource.state?.tone === "run") ? (
            <div className="flex items-center gap-4">
              {session && resource.kind === "container" && resource.state?.tone === "run" ? <RestartSandbox session={session} main={resource.key === "sandbox:main"} /> : null}
              {resource.dashboard ? (
                <a href={resource.dashboard} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-cf-dashboard>
                  Open in Cloudflare
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

export function CloudflareList({ resources, session, showRoles = true, className }: { readonly resources: readonly CloudflareResource[]; readonly session: string | null; readonly showRoles?: boolean; readonly className?: string }) {
  return (
    <ul className={cn("flex flex-col dash-t", className)} data-cloudflare>
      {resources.map((r) => (
        <Resource key={r.key} resource={r} showRoles={showRoles} session={session} />
      ))}
    </ul>
  );
}

export function CloudflareSections({ view, loading, error, session, group }: { readonly view: CloudflareView | null; readonly loading: boolean; readonly error: string | null; readonly session: string | null; readonly group: CloudflareResource["group"] }) {
  if (loading && !view) return <Skeleton className="h-28" />;
  if (!view) return <p className="text-sm text-muted-foreground">Could not read the Cloudflare details{error ? `: ${error}` : ""}.</p>;
  return <CloudflareList resources={view.resources.filter((r) => r.group === group)} session={session} />;
}
