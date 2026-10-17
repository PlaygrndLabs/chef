import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Group } from "@/components/settings-shell";
import { usageApi, type ProjectApi, type ProjectBudget, type Spending } from "@/lib/api";
import { host } from "@/host";

const MICROS = 1_000_000;

const useUsage = host.useUsage ?? (() => null);

const PARTS = [
  ["model", "Writing code"],
  ["router", "Routing"],
  ["voice", "Live talk"],
] as const;

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
  const parts = PARTS.filter(([part]) => (ledger.parts?.[part] ?? 0) > 0);
  return (
    <>
      {host.UsageSummary ? <host.UsageSummary /> : null}
      <Group title={`${monthName(ledger.month)} so far`} note="What Chef's model, routing and voice calls cost, estimated from tokens at list prices. Your Cloudflare bill is separate. When a budget is reached, Chef pauses new work until the budget is raised or the next month starts.">
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
      {parts.length > 0 ? (
        <Group title="By model" note="Writing code is Claude; routing is Jev; live talk is the voice model.">
          <ul className="grid gap-1.5" id="part-spending">
            {parts.map(([part, label]) => (
              <li key={part} className="flex items-center gap-2 text-sm" data-part-spent={part}>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="text-xs text-muted-foreground">{money(ledger.parts?.[part] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      <Group title="Projects" note="Each project's budget is set in its own settings, under General.">
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground">No spending yet this month.</p>
        ) : (
          <ul className="grid gap-1.5" id="project-spending">
            {projects.map((name) => (
              <li key={name} className="flex items-center gap-2 text-sm" data-project-spent={name}>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <span className="text-xs text-muted-foreground">
                  {money(ledger.projects[name] ?? 0)}
                  {caps.projects[name] !== undefined ? ` of ${money(caps.projects[name])}` : ""}
                </span>
              </li>
            ))}
          </ul>
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

export function ProjectBudgetGroup(props: { readonly api: ProjectApi }) {
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  useEffect(() => {
    props.api.budget().then(setBudget, () => setBudget(null));
  }, [props.api]);
  if (!budget) return null;
  return (
    <Group title="Monthly budget" note={`${money(budget.spent)} spent in ${monthName(budget.month)}. Chef pauses new work in this project when it reaches the budget. Leave it empty for no limit.`}>
      <div className="grid gap-2">
        <CapForm id="project-budget" label="Monthly budget for this project" cap={budget.cap} onSave={async (cap) => setBudget(await props.api.saveBudget(cap))} />
        <Bar spent={budget.spent} cap={budget.cap} />
      </div>
    </Group>
  );
}
