import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { AgentsView, ChoiceAnswer, RouteDecision, RouterSettings } from "@chef/core";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ToneBadge } from "@/components/status";
import { configOf, saveAgents } from "@/lib/agents";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const INTENT: Readonly<Record<string, string>> = { new_feature: "New feature", change_feature: "Change", chore: "Chore", question: "Question" };
const CHANGE: Readonly<Record<string, string>> = { bug: "bug fix", extend: "extend", refactor: "refactor" };
const VIA: Readonly<Record<RouteDecision["via"], string>> = { rules: "Rules", classifier: "Jev", planner: "Planner" };

const KINDS: readonly { readonly kind: string; readonly how: string }[] = [
  { kind: "New feature", how: "Plan, Tests, Build, Check and Live. The planner writes a new spec entry and a builder works in a new feature folder." },
  { kind: "Change: bug fix", how: "A new spec revision, then a test that shows the bug, the fix, review and checks." },
  { kind: "Change: extend", how: "New acceptance criteria on the same feature, tests first, then the code." },
  { kind: "Change: refactor", how: "Restructures the feature's code. Its existing tests must keep passing." },
  { kind: "Chore", how: "Work outside one feature, like dependencies, config, shared code, docs or CI. Start it with /chore. The Chore worker may change anything but specs and feature tests, every test must keep passing, and every live feature is proved again on its preview." },
  { kind: "Hotfix", how: "Start a fix with /hotfix. It runs one try, and other builds wait to go live until it is live, so it reaches the app first. Same tests, review and checks." },
  { kind: "Question", how: "Answered from the project's memory. No code changes." },
];

function Section(props: { readonly title: string; readonly note?: ReactNode; readonly children: ReactNode; readonly id?: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border p-4" data-router-section={props.id}>
      <div className="grid gap-1">
        <h2 className="text-sm font-medium">{props.title}</h2>
        {props.note ? <p className="text-xs text-muted-foreground">{props.note}</p> : null}
      </div>
      {props.children}
    </section>
  );
}

function Percent({ value, onChange, label }: { readonly value: number; readonly onChange: (next: number) => void; readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      sure at
      <Input type="number" min={0} max={100} step={5} value={Math.round(value * 100)} onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value))) / 100)} aria-label={label} className="h-7 w-16 px-2 text-xs" />%
    </span>
  );
}

function Answer(props: { readonly label: string; readonly value: string; readonly onChange: (next: string) => void; readonly threshold?: { readonly value: number; readonly onChange: (next: number) => void } }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
      <span className="font-mono text-xs">{props.label}</span>
      <Input value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label={`Meaning of ${props.label}`} className="h-8 text-sm" required />
      {props.threshold ? <Percent value={props.threshold.value} onChange={props.threshold.onChange} label={`Threshold for ${props.label}`} /> : <span />}
    </div>
  );
}

function Bars({ name, answer, labels }: { readonly name: string; readonly answer: ChoiceAnswer; readonly labels?: Readonly<Record<string, string>> }) {
  const top = Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  return (
    <div className="grid gap-1" data-answer={name}>
      <span className="text-xs text-muted-foreground">{name}</span>
      {top.map(([choice, p]) => (
        <div key={choice} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-2 text-xs">
          <span className={cn("truncate", choice === answer.choice && "font-medium")}>{labels?.[choice] ?? choice}</span>
          <span className="h-1.5 overflow-hidden bg-muted">
            <span className={cn("block h-full", choice === answer.choice ? "bg-foreground" : "bg-muted-foreground/40")} style={{ width: `${Math.round(p * 100)}%` }} />
          </span>
          <span className="text-right tabular-nums text-muted-foreground">{Math.round(p * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

export function Decision({ decision }: { readonly decision: RouteDecision }) {
  const { features } = useWorkspace();
  const feature = decision.featureId ? (features.find((f) => f.id === decision.featureId)?.title ?? decision.featureId) : null;
  const trace = decision.classifier ?? null;
  const answers = trace?.answers ?? {};
  const featureLabels = Object.fromEntries(features.map((f) => [f.id, f.title]));
  return (
    <div className="flex flex-col gap-2.5" data-decision={decision.intent} data-via={decision.via}>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-medium">
          {INTENT[decision.intent] ?? decision.intent}
          {decision.changeKind ? `: ${CHANGE[decision.changeKind] ?? decision.changeKind}` : ""}
        </span>
        {feature ? <span className="text-muted-foreground">to {feature}</span> : null}
        {decision.hotfix ? <ToneBadge tone="bad">hotfix</ToneBadge> : null}
        <ToneBadge tone={decision.via === "classifier" ? "ok" : "idle"}>decided by {VIA[decision.via]}</ToneBadge>
        <span className="text-xs text-muted-foreground tabular-nums">{Math.round(decision.confidence * 100)}% sure</span>
      </div>
      {decision.via !== "classifier" ? <p className="text-xs text-muted-foreground">{decision.reason}</p> : null}
      {trace ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">{trace.accepted ? `Jev (${trace.model}) was sure enough, so chef followed it.` : `Jev (${trace.model}) was not sure enough, so the Planner decided.`}</p>
          {answers["intent"] ? <Bars name="What is it?" answer={answers["intent"]} labels={INTENT} /> : null}
          {answers["feature"] && Object.keys(answers["feature"].probabilities).length > 1 ? <Bars name="Which feature?" answer={answers["feature"]} labels={{ ...featureLabels, none: "none" }} /> : null}
          {answers["change"] && decision.intent === "change_feature" ? <Bars name="What kind of change?" answer={answers["change"]} labels={CHANGE} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function TryIt() {
  const { api } = useWorkspace();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ readonly prompt: string; readonly decision: RouteDecision } | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      setResult({ prompt, decision: await api.route(prompt.trim()) });
    } catch (error) {
      toast.error("Could not route it", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Try it" note="See how chef would sort a request in this project. Nothing gets built." id="try">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="The add button does nothing on mobile" aria-label="Request to route" required />
        <Button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />}
          Route it
        </Button>
      </form>
      {result ? (
        <div className="flex flex-col gap-2 border-t pt-3" data-try-result>
          <p className="text-xs text-muted-foreground">“{result.prompt}”</p>
          <Decision decision={result.decision} />
        </div>
      ) : null}
    </Section>
  );
}

function Recent() {
  const { data } = useWorkspace();
  const routes = [...data.live.routes].reverse().slice(0, 25);
  return (
    <Section title="Recent decisions in this project" note="Newest first. Open one to see what Jev answered." id="recent">
      {routes.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : null}
      <ul className="flex flex-col divide-y">
        {routes.map((r, i) => (
          <li key={`${r.at}-${i}`}>
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 py-2 text-left text-sm">
                <span className="min-w-0 flex-1 truncate">{r.prompt}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {INTENT[r.decision.intent] ?? r.decision.intent} · {VIA[r.decision.via]} · {ago(r.at)}
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pb-3">
                <Decision decision={r.decision} />
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function RouterTab({ view }: { readonly view: AgentsView }) {
  const [draft, setDraft] = useState<RouterSettings>(view.router);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.router);
  const w = draft.wording;
  const t = draft.thresholds;
  const wording = (patch: Partial<RouterSettings["wording"]>) => setDraft((d) => ({ ...d, wording: { ...d.wording, ...patch } }));
  const threshold = (key: keyof RouterSettings["thresholds"]) => ({ value: t[key], onChange: (value: number) => setDraft((d) => ({ ...d, thresholds: { ...d.thresholds, [key]: value } })) });
  const save = async (router: RouterSettings | null, summary: string) => {
    setBusy(true);
    await saveAgents(view, { ...configOf(view), router }, summary);
    setBusy(false);
  };
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-5 sm:px-6" data-router>
      <Section title="How chef sorts each request" note="Three steps, in order. The first one that is sure decides.">
        <ol className="grid gap-2 text-sm sm:grid-cols-3">
          <li className="rounded-lg bg-muted/50 p-3">
            <div className="font-medium">1. Rules</div>
            <div className="text-xs text-muted-foreground">/new, /chore, /hotfix, a @feature mention, or a plain question.</div>
          </li>
          <li className="rounded-lg bg-muted/50 p-3" data-jev={view.jev ? "on" : "off"}>
            <div className="font-medium">2. Jev</div>
            <div className="text-xs text-muted-foreground">{view.jev ? "TypeSafe System One answers the three questions below in about 100 ms." : "Off: add a TypeSafe key in Settings > Router to use it."}</div>
          </li>
          <li className="rounded-lg bg-muted/50 p-3">
            <div className="font-medium">3. Planner</div>
            <div className="text-xs text-muted-foreground">Claude decides when Jev is off or not sure enough.</div>
          </li>
        </ol>
      </Section>
      {view.scope ? <TryIt /> : null}
      <form
        className="flex flex-col gap-5"
        data-router-form
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft, "Changed the router");
        }}
      >
        <Section title="Jev" note="Turn it off to let the Planner decide every request." id="jev">
          <div role="radiogroup" aria-label="Use Jev" className="grid w-fit grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {[true, false].map((on) => (
              <button key={String(on)} type="button" role="radio" aria-checked={draft.useJev === on} onClick={() => setDraft({ ...draft, useJev: on })} className={cn("rounded-md px-3 py-1.5 text-xs", draft.useJev === on ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {on ? "Use Jev" : "Planner only"}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Question 1: what is it?" note="chef follows Jev's answer only when Jev is at least this sure of it." id="intent">
          <Input value={w.intent.instructions} onChange={(e) => wording({ intent: { ...w.intent, instructions: e.target.value } })} aria-label="Question 1" required />
          <Answer label="new_feature" value={w.intent.criteria.new_feature} onChange={(v) => wording({ intent: { ...w.intent, criteria: { ...w.intent.criteria, new_feature: v } } })} threshold={threshold("new_feature")} />
          <Answer label="change_feature" value={w.intent.criteria.change_feature} onChange={(v) => wording({ intent: { ...w.intent, criteria: { ...w.intent.criteria, change_feature: v } } })} threshold={threshold("change_feature")} />
          <Answer label="chore" value={w.intent.criteria.chore} onChange={(v) => wording({ intent: { ...w.intent, criteria: { ...w.intent.criteria, chore: v } } })} threshold={threshold("chore")} />
          <Answer label="question" value={w.intent.criteria.question} onChange={(v) => wording({ intent: { ...w.intent, criteria: { ...w.intent.criteria, question: v } } })} threshold={threshold("question")} />
        </Section>
        <Section title="Question 2: which feature?" note="The answers are this project's feature titles, plus the one below." id="feature">
          <Input value={w.feature.instructions} onChange={(e) => wording({ feature: { ...w.feature, instructions: e.target.value } })} aria-label="Question 2" required />
          <Answer label="none" value={w.feature.none} onChange={(v) => wording({ feature: { ...w.feature, none: v } })} threshold={threshold("feature")} />
        </Section>
        <Section title="Question 3: what kind of change?" note="Asked only for changes. It shapes the plan, for example a bug fix starts with a test that shows the bug." id="change">
          <Input value={w.change.instructions} onChange={(e) => wording({ change: { ...w.change, instructions: e.target.value } })} aria-label="Question 3" required />
          <Answer label="bug" value={w.change.criteria.bug} onChange={(v) => wording({ change: { ...w.change, criteria: { ...w.change.criteria, bug: v } } })} />
          <Answer label="extend" value={w.change.criteria.extend} onChange={(v) => wording({ change: { ...w.change, criteria: { ...w.change.criteria, extend: v } } })} />
          <Answer label="refactor" value={w.change.criteria.refactor} onChange={(v) => wording({ change: { ...w.change, criteria: { ...w.change.criteria, refactor: v } } })} />
        </Section>
        <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
          <span className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : view.scope ? (view.scope.router ? "Saved for this project" : "Using the setting for all projects") : view.routerEdited ? "Saved" : "Using chef's default"}</span>
          <span className="flex-1" />
          {(view.scope ? view.scope.router : view.routerEdited) ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void save(null, view.scope ? "The router uses the setting for all projects" : "Reset the router to default")}>
              <RotateCcw />
              {view.scope ? "Use the setting for all projects" : "Reset to default"}
            </Button>
          ) : null}
          <Button type="submit" size="sm" disabled={busy || !dirty}>
            Save
          </Button>
        </div>
      </form>
      {view.scope ? <Recent /> : null}
      <Section title="Kinds of work" note="What each answer starts. Every kind goes through the same tests, review and checks before it goes live, and chef reverts a merge that turns the app red." id="kinds">
        <ul className="flex flex-col divide-y text-sm">
          {KINDS.map((k) => (
            <li key={k.kind} className="grid gap-0.5 py-2 sm:grid-cols-[10rem_1fr]">
              <span className="font-medium">{k.kind}</span>
              <span className="text-muted-foreground">{k.how}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
