import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GitHubPicker } from "@/components/github-picker";
import { githubApi, projectApi, projectsApi, type GitHubView, type GitLinkUpdate, type InstalledRepository, type OverviewState } from "@/lib/api";
import { useNow } from "@/lib/live";
import { useOverview } from "@/lib/overview";
import { projectNameFrom } from "@/lib/projects";
import { isProjectName } from "@/lib/selection";
import { cn } from "@/lib/utils";
import { Step, type StepState } from "@/components/step";

type Source = "fresh" | "github" | "other";

const SOURCES: readonly { readonly source: Source; readonly label: string }[] = [
  { source: "fresh", label: "Start fresh" },
  { source: "github", label: "From GitHub" },
  { source: "other", label: "Other git host" },
];

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {props.label}
      {props.children}
    </label>
  );
}

function otherLink(url: string, branch: string, token: string): GitLinkUpdate {
  const github = /^https:\/\/github\.com\//.test(url);
  const mode = token ? (github ? "pull-request" : "branch") : "off";
  return { url, ...(branch ? { branch } : {}), mode, syncBranch: "chef", ...(token ? { token } : {}) };
}

interface Plan {
  readonly name: string;
  readonly repository: string | null;
  readonly git: GitLinkUpdate | null;
}

interface Line {
  readonly kind: "step" | "log" | "error";
  readonly text: string;
  readonly at: number;
}

interface Run {
  readonly started: number;
  readonly lines: readonly Line[];
  readonly error: string | null;
}

const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

function stepsOf(run: Run, created: boolean, fallback: string, now: number) {
  const marks = run.lines.filter((l) => l.kind === "step");
  const list = marks.length > 0 ? marks : [{ kind: "step" as const, text: fallback, at: run.started }];
  return list.map((mark, i) => {
    const next = list[i + 1];
    const last = next === undefined;
    const end = next?.at ?? (last && (created || run.error) ? (run.lines.at(-1)?.at ?? now) : null);
    const state: StepState = !last ? "done" : run.error ? "failed" : created ? "done" : "run";
    return { label: mark.text, state, took: end === null ? (now - mark.at >= 1000 ? seconds(now - mark.at) : null) : seconds(end - mark.at) };
  });
}

function SetupLog(props: { readonly run: Run; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { run } = props;
  const box = useRef<HTMLDivElement>(null);
  const count = run.lines.length;
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, props.open]);
  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange}>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-setup-log-toggle>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {props.open ? "Hide log" : "Show log"}
        <span className="tabular-nums">({count})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div ref={box} className="mt-2 max-h-56 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed" data-setup-log role="log" aria-live="polite">
          {count === 0 ? <div className="text-muted-foreground">Waiting for Chef to start…</div> : null}
          {run.lines.map((line, i) => (
            <div key={i} className={cn("flex gap-2", line.kind === "step" && "mt-1 font-medium first:mt-0", line.kind === "error" && "text-bad")}>
              <span className="shrink-0 text-muted-foreground tabular-nums">{seconds(line.at - run.started).padStart(6)}</span>
              <span className="min-w-0 break-all whitespace-pre-wrap">{line.kind === "step" ? `▸ ${line.text}` : line.text}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Progress(props: { readonly plan: Plan; readonly run: Run; readonly created: boolean; readonly onOpen: () => void; readonly onBack: () => void }) {
  const { plan, run, created } = props;
  const api = useMemo(() => projectApi(plan.name), [plan.name]);
  const reads = plan.repository !== null;
  const { state } = useOverview(created && reads ? api : idle);
  const read: StepState = state?.status === "ready" ? "done" : state?.status === "failed" ? "failed" : created ? "run" : "wait";
  const [logOpen, setLogOpen] = useState(false);
  const [readSince, setReadSince] = useState<number | null>(null);
  const busy = !run.error && (!created || (reads && read === "run"));
  const now = useNow(busy ? 200 : 60_000);
  useEffect(() => {
    if (created && (!reads || state?.status === "ready" || state?.status === "none")) props.onOpen();
  }, [created, reads, state?.status]);
  useEffect(() => {
    if (run.error) setLogOpen(true);
  }, [run.error]);
  useEffect(() => {
    if (created && reads && readSince === null) setReadSince(Date.now());
  }, [created, reads, readSince]);
  const fallback = plan.repository ? `Copy ${plan.repository} into Chef and link it` : `Create ${plan.name} from Chef's starter app`;
  const steps = stepsOf(run, created, fallback, now);
  const readEnd = state?.status === "ready" || state?.status === "failed" ? state.at : null;
  const readLines: Line[] =
    readSince === null
      ? []
      : [
          { kind: "step", text: "Read the code and suggest first tasks", at: readSince },
          ...(state?.status === "ready" ? [{ kind: "log" as const, text: `Found ${state.overview.suggestions.length} suggested tasks and ${state.overview.problems.length} problems`, at: state.at }] : []),
          ...(state?.status === "failed" ? [{ kind: "error" as const, text: state.error, at: state.at }] : []),
        ];
  const shown: Run = { ...run, lines: [...run.lines, ...(run.error ? [{ kind: "error" as const, text: run.error, at: run.lines.at(-1)?.at ?? now }] : []), ...readLines] };
  return (
    <div className="grid gap-4" data-setup={run.error ? "failed" : created ? read : "creating"}>
      <ol className="grid gap-2.5">
        {steps.map((step, i) => (
          <Step key={i} state={step.state} took={step.took}>
            {step.label}
            {step.state === "failed" && run.error ? <span className="block text-xs text-bad">{run.error}</span> : null}
          </Step>
        ))}
        {reads && !run.error ? (
          <Step state={read} took={readSince === null ? null : readEnd !== null ? seconds(Math.max(0, readEnd - readSince)) : now - readSince >= 1000 ? seconds(now - readSince) : null}>
            Read the code and suggest first tasks
            {state?.status === "failed" ? <span className="block text-xs text-bad">{state.error}</span> : null}
          </Step>
        ) : null}
      </ol>
      <SetupLog run={shown} open={logOpen} onOpenChange={setLogOpen} />
      {run.error ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Nothing was added to your projects. Fix the problem and try again.</p>
          <Button type="button" size="sm" onClick={props.onBack}>
            Back
          </Button>
        </div>
      ) : created ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{!reads ? "" : read === "failed" ? "You can still open the project and ask Chef to read it again later." : "Chef keeps reading if you open the project now."}</p>
          <Button type="button" size="sm" variant={read === "failed" ? "default" : "outline"} onClick={props.onOpen}>
            Open {plan.name}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const idle = {
  overview: () => new Promise<OverviewState>(() => undefined),
  readCode: () => Promise.resolve({ status: "none" as const }),
};

export function NewProjectForm(props: { readonly onCreated: (name: string) => void; readonly onBusy?: (busy: boolean) => void; readonly autoFocus?: boolean; readonly fromGitHub?: boolean }) {
  const [source, setSource] = useState<Source>(props.fromGitHub ? "github" : "fresh");
  const [name, setName] = useState("");
  const [named, setNamed] = useState(false);
  const [github, setGitHub] = useState<GitHubView | null>(null);
  const [picked, setPicked] = useState<InstalledRepository | null>(null);
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [created, setCreated] = useState(false);
  const [run, setRun] = useState<Run>({ started: 0, lines: [], error: null });
  useEffect(() => {
    if (source === "github" && !github) githubApi.get().then(setGitHub, (e: unknown) => setGitHub({ app: null, repositories: [], error: e instanceof Error ? e.message : String(e) }));
  }, [source, github]);
  const suggest = (repository: string) => {
    if (!named) setName(projectNameFrom(repository));
  };
  const submit = async () => {
    const project = name.trim().toLowerCase();
    if (!isProjectName(project)) {
      toast.error("Use 2 to 31 lower case letters, digits and dashes, starting with a letter");
      return;
    }
    const git: GitLinkUpdate | null =
      source === "github" && picked
        ? { url: picked.url, branch: picked.defaultBranch, mode: "pull-request", syncBranch: "chef", github: true }
        : source === "other" && url.trim()
          ? otherLink(url.trim(), branch.trim(), token.trim())
          : null;
    if (source === "github" && !picked) {
      toast.error("Pick a repository first");
      return;
    }
    const next = { name: project, repository: source === "github" ? (picked?.fullName ?? null) : git ? url.trim() : null, git };
    setPlan(next);
    setCreated(false);
    setRun({ started: Date.now(), lines: [], error: null });
    props.onBusy?.(true);
    try {
      await projectsApi.create({ name: project, ...(git ? { git } : {}) }, (note) => {
        const at = Date.now();
        const line: Line = note.type === "step" ? { kind: "step", text: note.label, at } : { kind: "log", text: note.text, at };
        setRun((r) => ({ ...r, lines: [...r.lines, line] }));
      });
      setCreated(true);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setRun((r) => ({ ...r, error }));
    } finally {
      props.onBusy?.(false);
    }
  };
  if (plan) return <Progress plan={plan} run={run} created={created} onOpen={() => props.onCreated(plan.name)} onBack={() => setPlan(null)} />;
  return (
    <form
      id="new-project"
      className="grid gap-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div role="radiogroup" aria-label="Where the code comes from" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
        {SOURCES.map((s) => (
          <button key={s.source} type="button" role="radio" aria-checked={source === s.source} onClick={() => setSource(s.source)} className={cn("rounded-md px-2 py-1.5 text-xs", source === s.source ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {s.label}
          </button>
        ))}
      </div>
      {source === "fresh" ? <p className="text-xs text-muted-foreground">Chef starts from its starter app. Describe the first feature once the project is open.</p> : null}
      {source === "github" ? (
        <>
          <GitHubPicker
            returnTo="/?connect=new"
            github={github}
            selected={picked?.url ?? ""}
            onPick={(r) => {
              setPicked(r);
              suggest(r.fullName);
            }}
            onForget={() => {
              githubApi.forget().then(setGitHub, (e: unknown) => toast.error("Could not forget the app", { description: e instanceof Error ? e.message : String(e) }));
              setPicked(null);
            }}
          />
          {picked ? <p className="text-xs text-muted-foreground">Chef copies {picked.fullName} and reads it. Finished features come back as one pull request to {picked.defaultBranch}; change that later in Project settings.</p> : null}
        </>
      ) : null}
      {source === "other" ? (
        <>
          <Field label="Repository">
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (e.target.value.trim()) suggest(e.target.value.trim());
              }}
              placeholder="https://gitlab.com/you/app"
              aria-label="Repository URL"
              type="url"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Its main branch">
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Main branch" placeholder="Its default branch" />
            </Field>
            <Field label="Access token">
              <Input value={token} onChange={(e) => setToken(e.target.value)} aria-label="Access token" type="password" autoComplete="off" placeholder="Needed to send work back" />
            </Field>
          </div>
        </>
      ) : null}
      <Field label="Project name">
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNamed(e.target.value.trim() !== "");
          }}
          placeholder="my-app"
          aria-label="Project name"
          autoComplete="off"
          autoFocus={props.autoFocus && source === "fresh"}
          required
        />
      </Field>
      <Button type="submit" disabled={source === "github" && !picked}>
        <Plus />
        Create project
      </Button>
    </form>
  );
}

export function NewProjectDialog(props: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onCreated: (name: string) => void; readonly fromGitHub?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={props.open} onOpenChange={(open) => (busy ? undefined : props.onOpenChange(open))}>
      <DialogContent className="sm:max-w-md" data-dialog="new-project">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Each project is its own app with its own features, each running in its own sandbox. Start fresh or bring code you already have.</DialogDescription>
        </DialogHeader>
        {props.open ? (
          <NewProjectForm
            autoFocus
            fromGitHub={props.fromGitHub === true}
            onBusy={setBusy}
            onCreated={(name) => {
              props.onOpenChange(false);
              props.onCreated(name);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
