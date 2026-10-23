import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Group } from "@/components/settings-shell";
import type { BuildUsage, ProjectUsage } from "@chef/core";
import { addAll, PARTS, SPEND_GROUPS, SPEND_PARTS, sumOf, type Spend, type SpendGroup } from "@chef/core/usage";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status";
import { usageApi, type ProjectApi, type Spending } from "@/lib/api";
import { isActive } from "@/lib/events";
import { cost, duration, PLAIN_STATE, stateTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useOptionalWorkspace } from "@/lib/workspace";
import { host } from "@/host";

const MICROS = 1_000_000;

const useUsage = host.useUsage ?? (() => null);

const GROUP_LABEL: Record<SpendGroup, string> = { models: "Model", cloudflare: "Cloudflare" };

function PartList({ spend }: { readonly spend: Spend }) {
  const parts = SPEND_PARTS.filter((part) => (spend[part] ?? 0) > 0);
  return parts.length ? (
    <ul className="grid gap-1.5" data-parts>
      {parts.map((part) => (
        <li key={part} className="flex items-center gap-2 text-sm" data-part-spent={part}>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{PARTS[part].label}</span>
          <span className="tabular-nums">{cost(spend[part] ?? 0)}</span>
        </li>
      ))}
    </ul>
  ) : null;
}

export function money(micros: number): string {
  const value = micros / MICROS;
  return `$${value >= 100 ? Math.round(value).toLocaleString("en-US") : value.toFixed(2)}`;
}

function monthName(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function toInput(cap: number | null | undefined): string {
  return cap === null || cap === undefined ? "" : String(Math.round((cap / MICROS) * 100) / 100);
}

function fromInput(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

function Bar(props: { readonly spent: number; readonly cap: number | null }) {
  const share = props.cap ? Math.min(1, props.spent / props.cap) : 0;
  return props.cap ? (
    <div className="h-1 w-full bg-muted" aria-hidden>
      <div className={share >= 1 ? "h-full bg-bad" : share >= 0.8 ? "h-full bg-run" : "h-full bg-primary"} style={{ width: `${share * 100}%` }} />
    </div>
  ) : null;
}

function CapForm(props: { readonly id: string; readonly label: string; readonly cap: number | null | undefined; readonly disabled?: boolean; readonly onSave: (cap: number | null) => Promise<unknown> }) {
  const [text, setText] = useState(toInput(props.cap));
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(toInput(props.cap)), [props.cap]);
  const changed = text !== toInput(props.cap);
  return (
    <form
      id={props.id}
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const cap = fromInput(text);
        if (cap !== null && (!Number.isFinite(cap) || cap < 0)) return void toast.error("Enter a dollar amount, or leave it empty for no limit");
        setBusy(true);
        props
          .onSave(cap)
          .then(() => toast.success(cap === null ? "No limit" : "Budget saved"))
          .catch((error: unknown) => toast.error("Could not save", { description: error instanceof Error ? error.message : String(error) }))
          .finally(() => setBusy(false));
      }}
    >
      <span className="text-sm text-muted-foreground">$</span>
      <Input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="No limit" aria-label={props.label} className="w-28" disabled={props.disabled === true} />
      {props.disabled ? null : (
        <Button type="submit" size="sm" variant="outline" disabled={busy || !changed}>
          Save
        </Button>
      )}
    </form>
  );
}

export function UsageSection() {
  const [spending, setSpending] = useState<Spending | null>(null);
  const usage = useUsage();
  const manager = usage?.manager ?? true;
  const members = usage?.people ?? [];
  useEffect(() => {
    usageApi.get().then(setSpending, (e: unknown) => toast.error("Could not load usage", { description: e instanceof Error ? e.message : String(e) }));
  }, []);
  if (!spending) return <p className="text-xs text-muted-foreground">Loading usage</p>;
  const { caps, ledger } = spending;
  const projects = [...new Set([...Object.keys(ledger.projects), ...Object.keys(caps.projects)])].sort((a, b) => (ledger.projects[b] ?? 0) - (ledger.projects[a] ?? 0));
  const save = async (update: Parameters<typeof usageApi.save>[0]) => setSpending(await usageApi.save(update));
  return (
    <>
      {host.UsageSummary ? <host.UsageSummary /> : null}
      <Group title={`${monthName(ledger.month)} so far`} note="What Chef's model, routing and voice calls and its sandboxes on Cloudflare cost, estimated at list prices. Workers, Durable Objects and Artifacts aren't counted here; they come mostly within your Workers Paid plan. When a budget is reached, Chef pauses new work until the budget is raised or the next month starts.">
        <div className="grid gap-2" data-current="org-spent">
          <div className="flex items-baseline justify-between text-sm">
            <span>
              {money(ledger.org)} spent{caps.org !== null ? ` of ${money(caps.org)}` : ""}
            </span>
            <CapForm id="org-budget" label="Monthly budget for all projects" cap={caps.org} disabled={!manager} onSave={(cap) => save({ org: cap })} />
          </div>
          <Bar spent={ledger.org} cap={caps.org} />
        </div>
      </Group>
      {sumOf(ledger.parts) > 0 ? (
        <Group title="By part" note="Writing code is Claude; routing is Jev; live talk is the voice model; sandboxes are the containers builds and apps run in, billed for every second they are up.">
          <PartList spend={ledger.parts} />
        </Group>
      ) : null}
      <Group title="Projects" note="What each project spent this month: model calls and its sandboxes on Cloudflare. Open a project to see what each of its builds cost and to set its budget.">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground">No spending yet this month.</p>
        ) : (
          <div className="flex flex-col" id="project-spending">
            <SpendHead first="Project" />
            <ul className="flex flex-col dash-t">
              {projects.map((name) => (
                <ProjectRow key={name} name={name} spend={ledger.projectParts[name] ?? {}} cap={caps.projects[name]} />
              ))}
            </ul>
          </div>
        )}
      </Group>
      {members.length > 0 ? (
        <Group title="People" note="What each person's requests cost this month. A person's budget pauses only the work they asked for.">
          <ul className="grid gap-2" id="member-spending">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 text-sm" data-member-spent={m.email ?? m.userId}>
                <span className="min-w-0 flex-1 truncate">{m.email ?? m.userId}</span>
                <span className="text-xs text-muted-foreground">{money(ledger.members[m.userId] ?? 0)}</span>
                <CapForm id={`member-budget-${m.userId}`} label={`Monthly budget for ${m.email ?? "this person"}`} cap={caps.members[m.userId]} disabled={!manager} onSave={(cap) => save({ members: { [m.userId]: cap } })} />
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
    </>
  );
}

function Cells({ cells, className }: { readonly cells: readonly React.ReactNode[]; readonly className?: string }) {
  return <div className={cn("grid grid-cols-[minmax(0,1fr)_3.25rem_3.25rem_3.5rem] items-center gap-x-1.5 sm:grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_4.25rem] sm:gap-x-2 text-sm [&>*:not(:first-child)]:text-right [&>*:not(:first-child)]:tabular-nums", className)}>{cells}</div>;
}

function SpendCells({ label, spend, className }: { readonly label: React.ReactNode; readonly spend: Spend; readonly className?: string }) {
  return (
    <Cells
      {...(className ? { className } : {})}
      cells={[
        <span key="t" className="flex min-w-0 items-center gap-2">
          {label}
        </span>,
        ...SPEND_GROUPS.map((group) => (
          <span key={group} className="text-xs text-muted-foreground">
            {sumOf(spend, group) > 0 ? cost(sumOf(spend, group)) : "-"}
          </span>
        )),
        <span key="a">{cost(sumOf(spend))}</span>,
      ]}
    />
  );
}

function SpendHead({ first }: { readonly first: string }) {
  return <Cells className="pb-1.5 text-xs text-muted-foreground" cells={[<span key="t">{first}</span>, ...SPEND_GROUPS.map((group) => <span key={group}>{GROUP_LABEL[group]}</span>), <span key="a">Total</span>]} />;
}

function SpendRow(props: { readonly id: string; readonly kind: "project" | "build"; readonly label: React.ReactNode; readonly spend: Spend; readonly title?: string; readonly onOpen?: (() => void) | null }) {
  const cells = <SpendCells label={props.label} spend={props.spend} />;
  return (
    <li className="dash-b last:border-b-0" {...{ [`data-${props.kind}-usage`]: props.id }}>
      {props.onOpen ? (
        <button type="button" className="w-full py-2 text-left hover:bg-muted/60" title={props.title} onClick={props.onOpen}>
          {cells}
        </button>
      ) : (
        <div className="py-2" title={props.title}>
          {cells}
        </div>
      )}
    </li>
  );
}

function ProjectRow(props: { readonly name: string; readonly spend: Spend; readonly cap: number | undefined }) {
  const workspace = useOptionalWorkspace();
  const live = workspace?.projects.includes(props.name) ?? false;
  const label = (
    <span className="truncate">
      {props.name}
      {props.cap !== undefined ? <span className="text-xs text-muted-foreground"> of {money(props.cap)}</span> : null}
    </span>
  );
  const open = live && workspace ? () => workspace.select({ project: props.name, view: "project", feature: null, session: null, panel: null, settings: { scope: "project", section: "usage" }, item: null }) : null;
  return <SpendRow id={props.name} kind="project" label={label} spend={props.spend} title={open ? `Open ${props.name}'s usage` : "This project was deleted"} onOpen={open} />;
}

function BuildRow({ build }: { readonly build: BuildUsage }) {
  const workspace = useOptionalWorkspace();
  const label = (
    <>
      <StatusDot tone={stateTone(build.state)} />
      <span className="truncate">{build.title}</span>
    </>
  );
  const lifetime = sumOf(build.total) > sumOf(build.month) ? `, ${cost(sumOf(build.total))} since it started` : "";
  const title = `${build.title}, ${PLAIN_STATE[build.state].toLowerCase()}${build.sandboxSeconds ? `, sandbox up ${duration(build.sandboxSeconds * 1000)}` : ""}${lifetime}. Open its Details.`;
  return <SpendRow id={build.id} kind="build" label={label} spend={build.month} title={title} onOpen={() => workspace?.select({ view: "feature", feature: build.feature, session: build.id, panel: "details", settings: null, item: null })} />;
}

export function ProjectUsageSection(props: { readonly api: ProjectApi }) {
  const [usage, setUsage] = useState<ProjectUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    props.api.usage().then(setUsage, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.api]);
  if (error) return <p className="text-sm text-muted-foreground">Could not load the usage: {error}</p>;
  if (!usage) return <Skeleton className="h-48" aria-label="Loading usage" />;
  const shown = usage.builds.filter((b) => sumOf(b.month) > 0 || isActive(b.state));
  const total = [...shown.map((b) => b.month), usage.main, usage.outside].reduce<Spend>(addAll, {});
  return (
    <>
      <Group title={`${monthName(usage.month)} so far`} note="Everything this project spent this month, estimated at list prices. Chef pauses new work in this project when it reaches the budget. Leave the budget empty for no limit.">
        <div className="grid gap-3" data-project-month>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xl tabular-nums" data-project-spent>
              {money(usage.spent)}
              {usage.cap !== null ? <span className="text-sm text-muted-foreground"> of {money(usage.cap)}</span> : null}
            </span>
            <CapForm id="project-budget" label="Monthly budget for this project" cap={usage.cap} onSave={async (cap) => setUsage({ ...usage, ...(await props.api.saveBudget(cap)) })} />
          </div>
          <Bar spent={usage.spent} cap={usage.cap} />
          <PartList spend={usage.parts} />
        </div>
      </Group>
      <Group title="By build" note="What each build cost this month: the model calls made for it and its sandbox on Cloudflare. Open one to see its Details. Main's app and the project chat, which belong to no build, have their own rows.">
        {sumOf(total) === 0 && shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing has cost anything yet this month.</p>
        ) : (
          <div className="flex flex-col" data-project-builds>
            <SpendHead first="Build" />
            <ul className="flex flex-col dash-t">
              {shown.map((b) => (
                <BuildRow key={b.id} build={b} />
              ))}
              {sumOf(usage.main) > 0 ? <SpendRow id="main" kind="build" label={<span className="truncate text-muted-foreground">Main's app</span>} spend={usage.main} title={`Main's app runs in its own sandbox${usage.mainSeconds ? `, up ${duration(usage.mainSeconds * 1000)} so far` : ""}.`} /> : null}
              {sumOf(usage.outside) > 0 ? <SpendRow id="outside" kind="build" label={<span className="truncate text-muted-foreground">Chat, routing and planning</span>} spend={usage.outside} title="Calls this month that belong to no build: the project chat, live talk, routing requests to features, and planning before a build starts." /> : null}
            </ul>
            <SpendCells className="pt-2 font-medium" label="Total" spend={total} />
          </div>
        )}
      </Group>
    </>
  );
}
