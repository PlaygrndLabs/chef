import { useEffect, useState, type ReactNode } from "react";
import { Bot, BookOpen, Brain, FolderGit2, KeyRound, Route, ScrollText, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { OutboundMode, SyncState } from "@chef/core";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitHubPicker } from "@/components/github-picker";
import { EnvironmentForm } from "@/components/environment";
import { MemoryForm, ProjectInstructionsForm } from "@/components/guidance";
import { AgentsSection, type AgentSection, type AgentsNav } from "@/components/agents-view";
import { Group, SettingsShell, type SettingsSection } from "@/components/settings-shell";
import { ProjectBudgetGroup } from "@/components/usage";
import { host } from "@/host";
import { githubApi, projectsApi, type GitHubView, type GitLinkView, type ProjectApi, type ProjectSettingsUpdate, type ProjectSettingsView } from "@/lib/api";
import { cn } from "@/lib/utils";

const MODES: readonly { readonly mode: OutboundMode; readonly label: string; readonly note: string; readonly pullRequests?: true }[] = [
  { mode: "pull-request", label: "One pull request", note: "Chef keeps one pull request from the sync branch up to date, listing each finished feature with a link to its app.", pullRequests: true },
  { mode: "feature-pull-requests", label: "A pull request per feature", note: "Each finished feature gets its own branch and pull request.", pullRequests: true },
  { mode: "branch", label: "Sync branch only", note: "Chef mirrors its main to the sync branch. You merge it when you like." },
  { mode: "off", label: "Pull only", note: "Chef takes changes from your repository but never pushes back." },
];

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {props.label}
      {props.children}
    </label>
  );
}

function SyncStatus(props: { readonly project: string; readonly api: ProjectApi; readonly git: GitLinkView }) {
  const [state, setState] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    props.api.git().then((r) => setState(r.state), () => setState(null));
  }, [props.api, props.git]);
  const webhook = `${location.origin}/api/projects/${props.project}/git/webhook`;
  const sync = async () => {
    setBusy(true);
    try {
      await props.api.syncGit();
      toast.success("Syncing with the repository");
    } catch (e) {
      toast.error("Could not start a sync", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2 rounded-lg border p-3 text-xs" data-git-state={state?.failed ? "stuck" : "ok"}>
      <p className="text-muted-foreground">
        {state?.pulled ? `Last taken from ${props.git.branch}: ${state.pulled.slice(0, 7)}.` : `Nothing taken from ${props.git.branch} yet.`} {state?.pushed ? `Last sent: ${state.pushed.slice(0, 7)}.` : ""}
      </p>
      {state?.failed ? <p className="text-bad">Chef could not merge {state.failed.slice(0, 7)} from {props.git.branch}. Fix it there or press Sync now to try again.</p> : null}
      {state?.pullRequest ? (
        <a className="underline" href={state.pullRequest.url} target="_blank" rel="noreferrer">
          Pull request #{state.pullRequest.number}
        </a>
      ) : null}
      {props.git.github ? (
        <p className="text-muted-foreground">GitHub tells Chef about every push, and Chef also checks every 5 minutes.</p>
      ) : (
        <>
          <p className="text-muted-foreground">Chef checks the repository every 5 minutes. For instant syncs, add a webhook for push events:</p>
          <Input readOnly value={webhook} aria-label="Webhook URL" onFocus={(e) => e.currentTarget.select()} />
          <Input readOnly value={props.git.webhookSecret} aria-label="Webhook secret" type="password" onFocus={(e) => ((e.currentTarget.type = "text"), e.currentTarget.select())} />
        </>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void sync()}>
          Sync now
        </Button>
      </div>
    </div>
  );
}

function RepositoryForm(props: { readonly project: string; readonly api: ProjectApi; readonly current: GitLinkView | null; readonly save: (update: ProjectSettingsUpdate, done?: string) => Promise<boolean> }) {
  const { current } = props;
  const [source, setSource] = useState<"github" | "other">(current && !current.github ? "other" : "github");
  const [github, setGitHub] = useState<GitHubView | null>(null);
  const [url, setUrl] = useState(current?.url ?? "");
  const [branch, setBranch] = useState(current?.branch ?? "");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<OutboundMode>(current?.mode ?? "pull-request");
  const [syncBranch, setSyncBranch] = useState(current?.syncBranch ?? "chef");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    githubApi.get().then(setGitHub, (e: unknown) => setGitHub({ app: null, repositories: [], error: e instanceof Error ? e.message : String(e) }));
  }, []);
  const viaGitHub = source === "github";
  const onGitHub = /^https:\/\/github\.com\//.test(url.trim());
  const choices = MODES.filter((m) => !m.pullRequests || onGitHub || !url.trim());
  const ready = viaGitHub ? Boolean(github?.app && url) : true;
  const run = async (update: ProjectSettingsUpdate, done?: string) => {
    setBusy(true);
    try {
      if (await props.save(update, done)) setToken("");
    } finally {
      setBusy(false);
    }
  };
  const switchSource = (next: "github" | "other") => {
    setSource(next);
    if (next !== (current?.github ? "github" : "other")) setUrl("");
    else setUrl(current?.url ?? "");
  };
  return (
    <form
      id="project-git"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        const link = viaGitHub ? { github: true } : token.trim() ? { token: token.trim() } : {};
        void run({ git: { url: url.trim(), ...(branch.trim() ? { branch: branch.trim() } : {}), mode, syncBranch: syncBranch.trim(), ...link } }, current ? "Saved" : "Linked; Chef is taking the repository in");
      }}
    >
      {viaGitHub ? (
        <GitHubPicker
          returnTo={`/?project=${props.project}&settings=project.repository`}
          github={github}
          selected={url}
          onPick={(r) => {
            setUrl(r.url);
            setBranch(r.defaultBranch);
          }}
          onForget={() => {
            githubApi.forget().then(
              (view) => setGitHub(view),
              (e: unknown) => toast.error("Could not forget the app", { description: e instanceof Error ? e.message : String(e) }),
            );
          }}
        />
      ) : (
        <>
          <Field label="Repository">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gitlab.com/you/app" aria-label="Repository URL" type="url" required />
          </Field>
          <Field label={current?.tokenHint ? `Access token (current ${current.tokenHint})` : "Access token"}>
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder={current?.tokenHint ? "Enter a new token to replace the current one" : "Token that can push branches and open pull requests"} aria-label="Access token" type="password" autoComplete="off" required={mode !== "off" && !current?.tokenHint} />
          </Field>
        </>
      )}
      <button type="button" className="justify-self-start text-xs text-muted-foreground underline" onClick={() => switchSource(viaGitHub ? "other" : "github")}>
        {viaGitHub ? "Use another git host or an access token instead" : "Connect through GitHub instead"}
      </button>
      {ready ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Its main branch">
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Main branch" placeholder="Its default branch" />
            </Field>
            <Field label="chef's branch there">
              <Input value={syncBranch} onChange={(e) => setSyncBranch(e.target.value)} aria-label="Sync branch" required disabled={mode === "off"} />
            </Field>
          </div>
          <div role="radiogroup" aria-label="Send work back" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {choices.map((c) => (
              <button key={c.mode} type="button" role="radio" aria-checked={mode === c.mode} onClick={() => setMode(c.mode)} className={cn("rounded-md px-2 py-1.5 text-xs", mode === c.mode ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{MODES.find((m) => m.mode === mode)?.note} Chef never pushes to {branch.trim() || "main"}.</p>
        </>
      ) : null}
      <div className="flex justify-end gap-2">
        {current ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run({ git: null }, "Unlinked; the project stays on Chef")}>
            Unlink
          </Button>
        ) : null}
        {ready ? (
          <Button type="submit" size="sm" disabled={busy || !url.trim()}>
            {current ? "Save" : "Link"}
          </Button>
        ) : null}
      </div>
      {current ? <SyncStatus project={props.project} api={props.api} git={current} /> : null}
    </form>
  );
}

type Save = (update: ProjectSettingsUpdate, done?: string) => Promise<boolean>;

function AppsForm(props: { readonly minutes: number; readonly save: Save }) {
  const [minutes, setMinutes] = useState(String(props.minutes));
  return (
    <form
      id="project-apps"
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void props.save({ appIdleMinutes: Number(minutes) });
      }}
    >
      <Field label="Minutes without visits before a running app sleeps">
        <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="App idle minutes" type="number" min={5} max={10080} required />
      </Field>
      <Button type="submit" size="sm">
        Save
      </Button>
    </form>
  );
}

function TriesForm(props: { readonly own: number | null; readonly shared: number | null; readonly save: Save }) {
  const [count, setCount] = useState(String(props.own ?? props.shared ?? 1));
  const own = props.own !== null;
  return (
    <form
      id="project-attempts"
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void props.save({ attempts: Number(count) });
      }}
    >
      <p className="text-xs text-muted-foreground" data-current="attempts" data-own={own ? "yes" : "no"}>
        {own ? `This project builds each new feature ${props.own === 1 ? "once" : `${props.own} ways at once`}.` : `Uses the setting for all projects${props.shared ? `: ${props.shared}` : ""}.`}
      </p>
      <div className="flex items-end gap-2">
        <Field label="Parallel tries per feature">
          <Input value={count} onChange={(e) => setCount(e.target.value)} aria-label="Parallel tries for this project" type="number" min={1} max={4} required />
        </Field>
        <Button type="submit" size="sm">
          Save
        </Button>
        {own ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => void props.save({ attempts: null }, "Uses the setting for all projects")}>
            Use the setting for all projects
          </Button>
        ) : null}
      </div>
    </form>
  );
}

const MERGE_CHOICES = [
  { mode: "auto", label: "Automatic", note: "A build goes live as soon as it passes every check." },
  { mode: "manual", label: "Manual", note: "A build waits after its checks pass until someone presses Merge." },
] as const;

function MergeForm(props: { readonly mode: "auto" | "manual"; readonly save: Save }) {
  return (
    <div className="grid gap-2" data-merge-mode={props.mode}>
      <div role="radiogroup" aria-label="Merging" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {MERGE_CHOICES.map((c) => (
          <button key={c.mode} type="button" role="radio" aria-checked={props.mode === c.mode} onClick={() => void props.save({ merge: c.mode }, c.mode === "auto" ? "Builds merge on their own" : "Builds wait for you to merge them")} className={cn("rounded-md px-2 py-1.5 text-xs", props.mode === c.mode ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{MERGE_CHOICES.find((c) => c.mode === props.mode)?.note}</p>
    </div>
  );
}

function DeleteProjectGroup(props: { readonly project: string; readonly linked: string | null }) {
  const { project } = props;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await projectsApi.remove(project);
      toast.success(`Deleted ${project}`);
      location.replace("/");
    } catch (e) {
      toast.error(`Could not delete ${project}`, { description: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  return (
    <Group
      title="Delete project"
      note={`Removes ${project} from Chef, with its running apps, code, memory and keys on your Cloudflare account.${props.linked ? " The linked repository stays as it is." : ""}`}
      action={
        <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 />
          Delete project
        </Button>
      }
    >
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          setTyped("");
        }}
      >
        <AlertDialogContent data-dialog="delete-project">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {project}?</AlertDialogTitle>
            <AlertDialogDescription>
              Chef stops all work on it and removes its running apps, code and memory from your Cloudflare account. This can't be undone.{props.linked ? ` ${props.linked} stays as it is.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field label={`Type ${project} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Project name to delete" className="font-mono" autoComplete="off" disabled={busy} />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy || typed.trim() !== project}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {busy ? "Deleting…" : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Group>
  );
}

export function ProjectSettingsDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly project: string;
  readonly api: ProjectApi;
  readonly onSaved?: () => void;
  readonly section: string;
  readonly item: string | null;
  readonly nav: AgentsNav & { readonly section: (section: string) => void };
  readonly sharedAttempts: number | null;
  readonly onEditShared: () => void;
}) {
  const { open, project, api, nav } = props;
  const [settings, setSettings] = useState<ProjectSettingsView | null>(null);
  useEffect(() => {
    if (open) api.settings().then(setSettings, (e: unknown) => toast.error("Could not load the project settings", { description: e instanceof Error ? e.message : String(e) }));
  }, [open, api]);
  const save: Save = async (update, done = "Saved") => {
    try {
      setSettings(await api.saveSettings(update));
      toast.success(done);
      props.onSaved?.();
      return true;
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };
  const loading = () => <p className="text-xs text-muted-foreground">Loading…</p>;
  const agents = (section: AgentSection) => () => <AgentsSection project={project} section={section} item={props.item} nav={nav} />;
  const sections: SettingsSection[] = [
    {
      id: "general",
      label: "General",
      icon: SlidersHorizontal,
      note: "Settings for this project only. Anything not set here comes from Settings for every project.",
      render: () =>
        settings ? (
          <>
            <Group title="Name" note="Its address in Chef, the addresses of its apps and its Cloudflare resources use this name.">
              <Input value={project} readOnly aria-label="Project name" className="font-mono" />
            </Group>
            <Group title="Parallel tries" note="How many ways Chef builds each new feature at once in this project. Each try costs as much as a whole build.">
              <TriesForm key={`${settings.attempts ?? "shared"}`} own={settings.attempts ?? null} shared={props.sharedAttempts} save={save} />
            </Group>
            <Group title="Merging" note="Every build starts from main, takes in what lands on main while it works, and merges into main when it is done.">
              <MergeForm mode={settings.merge ?? "auto"} save={save} />
            </Group>
            <ProjectBudgetGroup api={api} />
            <Group title="Apps" note="Each branch runs its app, with the whole stack from its compose file, in its own sandbox, and main runs the release candidate. A running app sleeps after it sits unused and starts again when someone opens it.">
              <AppsForm key={settings.appIdleMinutes} minutes={settings.appIdleMinutes} save={save} />
            </Group>
            <DeleteProjectGroup project={project} linked={settings.git?.url ?? null} />
          </>
        ) : (
          loading()
        ),
    },
    {
      id: "repository",
      label: "Repository",
      icon: FolderGit2,
      note: "Chef always works on its own copy of the code. Linking a repository is optional and only keeps the two in sync.",
      render: () =>
        settings ? (
          <Group title={settings.git ? "Linked repository" : "Link a repository"} note="Chef takes in every push to the repository's main branch and sends finished features back the way you pick below.">
            <RepositoryForm key={settings.git?.url ?? "none"} project={project} api={api} current={settings.git} save={save} />
          </Group>
        ) : (
          loading()
        ),
    },
    {
      id: "instructions",
      label: "Instructions",
      icon: ScrollText,
      note: "Every agent in this project reads the goal and follows these instructions, on top of the instructions for every project.",
      render: () => <ProjectInstructionsForm api={api} onEditShared={props.onEditShared} />,
    },
    {
      id: "memory",
      label: "Memory",
      icon: Brain,
      note: "What Chef remembers about this project. Agents recall the entries that fit each task. It lives in the memory folder of the project's code.",
      render: () => <MemoryForm api={api} />,
    },
    { id: "agents", label: "Agents", icon: Bot, fill: true, render: agents("agents") },
    { id: "skills", label: "Skills", icon: BookOpen, fill: true, render: agents("skills") },
    { id: "router", label: "Router", icon: Route, fill: true, render: agents("router") },
    {
      id: "environment",
      label: "Environment",
      icon: KeyRound,
      note: "Keys and settings this project's app reads at runtime. Values set for all projects show here too; set one here to use a different value in this project. Running apps get the values; agents only see the names.",
      render: () => <EnvironmentForm api={api} />,
    },
    ...(host.projectSections?.(project) ?? []),
  ];
  return (
    <SettingsShell
      open={open}
      onOpenChange={props.onOpenChange}
      name="project-settings"
      kicker="Project settings"
      heading={project}
      description={`Settings for the project ${project}`}
      sections={sections}
      active={props.section}
      onSelect={nav.section}
    />
  );
}
