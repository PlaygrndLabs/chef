import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, CircleAlert, KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GitHubPicker } from "@/components/github-picker";
import { missingSettings, SettingsDialog, useSettings } from "@/components/settings-dialog";
import { githubApi, projectApi, projectsApi, type GitHubView, type GitLinkUpdate, type InstalledRepository } from "@/lib/api";
import { useOverview } from "@/lib/overview";
import { projectNameFrom } from "@/lib/projects";
import { isProjectName } from "@/lib/selection";
import { cn } from "@/lib/utils";

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
  return { url, branch: branch || "main", mode, syncBranch: "chef", ...(token ? { token } : {}) };
}

interface Plan {
  readonly name: string;
  readonly repository: string | null;
  readonly git: GitLinkUpdate | null;
}

function Step(props: { readonly state: "wait" | "run" | "done" | "failed"; readonly children: ReactNode }) {
  return (
    <li className={cn("flex items-start gap-2.5 text-sm", props.state === "wait" && "text-muted-foreground")} data-step={props.state}>
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
        {props.state === "run" ? <Loader2 className="size-4 animate-spin" /> : props.state === "done" ? <Check className="size-4 text-ok" /> : props.state === "failed" ? <CircleAlert className="size-4 text-bad" /> : <span className="size-1.5 rounded-full bg-muted-foreground/50" />}
      </span>
      <span className="min-w-0 flex-1">{props.children}</span>
    </li>
  );
}

function Progress(props: { readonly plan: Plan; readonly created: boolean; readonly onOpen: () => void }) {
  const { plan, created } = props;
  const api = useMemo(() => projectApi(plan.name), [plan.name]);
  const { state } = useOverview(created && plan.repository ? api : idle);
  const reading = Boolean(plan.repository);
  const read = state?.status === "ready" ? "done" : state?.status === "failed" ? "failed" : created ? "run" : "wait";
  useEffect(() => {
    if (created && (!reading || state?.status === "ready")) props.onOpen();
  }, [created, reading, state?.status]);
  return (
    <div className="grid gap-4" data-setup={created ? (reading ? read : "done") : "creating"}>
      <ol className="grid gap-2.5">
        <Step state={created ? "done" : "run"}>{plan.repository ? `Copy ${plan.repository} into chef and link it` : `Create ${plan.name} from chef's starter app`}</Step>
        {reading ? (
          <Step state={read}>
            Read the code and suggest first tasks
            {state?.status === "failed" ? <span className="block text-xs text-bad">{state.error}</span> : null}
          </Step>
        ) : null}
      </ol>
      {created && reading ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{read === "failed" ? "You can still open the project and ask chef to read it again later." : "chef keeps reading if you open the project now."}</p>
          <Button type="button" size="sm" variant={read === "failed" ? "default" : "outline"} onClick={props.onOpen}>
            Open {plan.name}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const idle = {
  overview: () => Promise.resolve({ status: "none" as const }),
  readCode: () => Promise.resolve({ status: "none" as const }),
};

export function returningToNewProject(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get("connect") !== "new") return false;
  params.delete("connect");
  history.replaceState(null, "", `?${params.toString()}`);
  return true;
}

export function NewProjectForm(props: { readonly onCreated: (name: string) => void; readonly onBusy?: (busy: boolean) => void; readonly autoFocus?: boolean; readonly fromGitHub?: boolean }) {
  const [source, setSource] = useState<Source>(props.fromGitHub ? "github" : "fresh");
  const [name, setName] = useState("");
  const [named, setNamed] = useState(false);
  const [github, setGitHub] = useState<GitHubView | null>(null);
  const [picked, setPicked] = useState<InstalledRepository | null>(null);
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [created, setCreated] = useState(false);
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
    props.onBusy?.(true);
    try {
      await projectsApi.create({ name: project, ...(git ? { git } : {}) });
      setCreated(true);
    } catch (e) {
      setPlan(null);
      toast.error("Could not create the project", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      props.onBusy?.(false);
    }
  };
  if (plan) return <Progress plan={plan} created={created} onOpen={() => props.onCreated(plan.name)} />;
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
      {source === "fresh" ? <p className="text-xs text-muted-foreground">chef starts from its starter app. Describe the first feature once the project is open.</p> : null}
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
          {picked ? <p className="text-xs text-muted-foreground">chef copies {picked.fullName} and reads it. Finished features come back as one pull request to {picked.defaultBranch}; change that later in Project settings.</p> : null}
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
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Main branch" />
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
          <DialogDescription>Each project is its own app with its own features and previews. Start fresh or bring code you already have.</DialogDescription>
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

export function Setup(props: { readonly onCreated: (name: string) => void }) {
  const { settings, setSettings, available } = useSettings();
  const [providers, setProviders] = useState(false);
  const [fromGitHub] = useState(returningToNewProject);
  const missing = available && missingSettings(settings).length > 0;
  useEffect(() => {
    if (missing) setProviders(true);
  }, [missing]);
  return (
    <div className="flex h-dvh flex-col overflow-y-auto" data-view="setup">
      <div className="flex justify-end p-3">
        {available ? (
          <Button variant="ghost" size="sm" onClick={() => setProviders(true)} className={missing ? "text-bad" : undefined}>
            <KeyRound />
            Settings
          </Button>
        ) : null}
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-3 px-4 pt-10 pb-16 text-center sm:pt-20">
        <span className="grid size-11 place-items-center rounded-xl bg-brand text-lg font-semibold text-brand-foreground">c</span>
        <h1 className="text-2xl font-semibold tracking-tight">Create your first project</h1>
        <p className="text-muted-foreground">Start fresh, or bring a repository you already have and chef reads it first.</p>
        <div className="mt-4 w-full">
          <NewProjectForm autoFocus fromGitHub={fromGitHub} onCreated={props.onCreated} />
        </div>
      </div>
      {available ? <SettingsDialog open={providers} onOpenChange={setProviders} settings={settings} onChange={setSettings} /> : null}
    </div>
  );
}
