import { useState } from "react";
import { Check, Cloud, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status";
import type { CloudflareFact, CloudflareKind, CloudflareResource, CloudflareView } from "@chef/core";
import { roleLabel, useAgents } from "@/lib/agents";
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

function Fact({ fact }: { readonly fact: CloudflareFact }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{fact.label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        {fact.href ? (
          <a href={fact.href} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono underline-offset-2 hover:underline">
            {fact.value}
          </a>
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

function Resource({ resource, showRoles }: { readonly resource: CloudflareResource; readonly showRoles: boolean }) {
  return (
    <li className="flex flex-col gap-1.5 py-3 dash-b last:border-b-0" data-cf={resource.key} data-cf-kind={resource.kind} data-cf-roles={resource.roles.join(" ") || undefined}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-brand" title={`Cloudflare ${KIND[resource.kind]}`}>
          <Cloud className="size-3.5" aria-hidden="true" data-cf-cloud />
          <span className="kicker text-brand">{KIND[resource.kind]}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{resource.title}</span>
        {resource.state ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs" data-cf-state={resource.state.tone}>
            <StatusDot tone={resource.state.tone} />
            {resource.state.text}
          </span>
        ) : null}
        <span className="flex-1" />
        {resource.dashboard ? (
          <a href={resource.dashboard} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-cf-dashboard>
            Cloudflare
            <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate font-mono text-sm" title={resource.name}>
          {resource.name}
        </span>
        <CopyButton value={resource.name} label="name" />
      </div>
      {resource.facts.length ? (
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {resource.facts.map((fact) => (
            <Fact key={fact.label} fact={fact} />
          ))}
        </dl>
      ) : null}
      {showRoles && resource.roles.length ? <UsedBy roles={resource.roles} /> : null}
    </li>
  );
}

export function CloudflareList({ resources, showRoles = true, className }: { readonly resources: readonly CloudflareResource[]; readonly showRoles?: boolean; readonly className?: string }) {
  return (
    <ul className={cn("flex flex-col dash-t", className)} data-cloudflare>
      {resources.map((r) => (
        <Resource key={r.key} resource={r} showRoles={showRoles} />
      ))}
    </ul>
  );
}

export function CloudflareSections({ view, loading, error }: { readonly view: CloudflareView | null; readonly loading: boolean; readonly error: string | null }) {
  if (loading && !view) return <Skeleton className="h-40" />;
  if (!view) return <p className="text-sm text-muted-foreground">Could not read the Cloudflare details{error ? `: ${error}` : ""}.</p>;
  const session = view.resources.filter((r) => r.group === "session");
  const project = view.resources.filter((r) => r.group === "project");
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">
        Everything here runs on {view.accountId ? <span className="font-mono">account {view.accountId}</span> : "your Cloudflare account"}, under the Chef engine <span className="font-mono">{view.engine}</span>. The Cloudflare links open the dashboard for that account.
      </p>
      <div className="flex flex-col gap-1">
        <h4 className="kicker">This build</h4>
        <CloudflareList resources={session} />
      </div>
      <div className="flex flex-col gap-1">
        <h4 className="kicker">Shared by the project</h4>
        <CloudflareList resources={project} />
      </div>
    </div>
  );
}
