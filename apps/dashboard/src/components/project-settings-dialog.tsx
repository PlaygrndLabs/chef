import { useEffect, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import type { OutboundMode, SyncState } from "@chef/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { githubApi, type GitHubView, type GitLinkView, type InstalledRepository, type ProjectApi, type ProjectSettingsUpdate, type ProjectSettingsView } from "@/lib/api";
import { cn } from "@/lib/utils";

const MODES: readonly { readonly mode: OutboundMode; readonly label: string; readonly note: string; readonly pullRequests?: true }[] = [
  { mode: "pull-request", label: "One pull request", note: "chef keeps one pull request from the sync branch up to date, listing each finished feature with its preview link.", pullRequests: true },
  { mode: "feature-pull-requests", label: "A pull request per feature", note: "Each finished feature gets its own branch and pull request.", pullRequests: true },
  { mode: "branch", label: "Sync branch only", note: "chef mirrors its main to the sync branch. You merge it when you like." },
  { mode: "off", label: "Pull only", note: "chef takes changes from your repository but never pushes back." },
];

function Section(props: { readonly title: string; readonly note: string; readonly children: ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{props.title}</h3>
        <p className="text-xs text-muted-foreground">{props.note}</p>
      </div>
      {props.children}
    </div>
  );
}

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
      {state?.failed ? <p className="text-bad">chef could not merge {state.failed.slice(0, 7)} from {props.git.branch}. Fix it there or press Sync now to try again.</p> : null}
      {state?.pullRequest ? (
        <a className="underline" href={state.pullRequest.url} target="_blank" rel="noreferrer">
          Pull request #{state.pullRequest.number}
        </a>
      ) : null}
      {props.git.github ? (
        <p className="text-muted-foreground">GitHub tells chef about every push, and chef also checks every 5 minutes.</p>
      ) : (
        <>
          <p className="text-muted-foreground">chef checks the repository every 5 minutes. For instant syncs, add a webhook for push events:</p>
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

function GitHubPicker(props: { readonly project: string; readonly github: GitHubView | null; readonly selected: string; readonly onPick: (repo: InstalledRepository) => void; readonly onForget: () => void }) {
  const { github } = props;
  const [query, setQuery] = useState("");
  const [organization, setOrganization] = useState("");
  const returnTo = `/?project=${props.project}&connect=github`;
  if (!github) return <p className="text-xs text-muted-foreground">Checking GitHub…</p>;
  if (!github.app)
    return (
      <div className="grid gap-2.5 rounded-lg border p-3" data-github="none">
        <p className="text-xs text-muted-foreground">chef sends you to GitHub, where you pick the repositories it may use, then brings you back here. The first time, GitHub also asks you to create chef&apos;s own app for this deployment.</p>
        <Field label="GitHub organization that owns the repositories (leave empty for your own account)">
          <Input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="your-org" aria-label="GitHub organization" autoComplete="off" />
        </Field>
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => location.assign(githubApi.connectUrl(returnTo, organization.trim() || undefined))}>
            Connect GitHub
          </Button>
        </div>
      </div>
    );
  const shown = github.repositories.filter((r) => r.fullName.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="grid gap-2" data-github="connected">
      {github.repositories.length > 6 ? <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" /> : null}
      <div role="radiogroup" aria-label="GitHub repository" className="grid max-h-48 gap-px overflow-y-auto rounded-lg border p-1">
        {shown.map((r) => (
          <button key={r.fullName} type="button" role="radio" aria-checked={props.selected === r.url} onClick={() => props.onPick(r)} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", props.selected === r.url ? "bg-muted font-medium" : "hover:bg-muted/60")}>
            <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
            {r.private ? <Lock className="size-3 text-muted-foreground" aria-label="Private" /> : null}
          </button>
        ))}
        {shown.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{github.error ?? (github.repositories.length === 0 ? "chef cannot see any repositories yet." : "No repository matches.")}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Missing one?{" "}
        <button type="button" className="underline" onClick={() => location.assign(githubApi.connectUrl(returnTo))}>
          Add repositories on GitHub
        </button>
        {" · "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            if (confirm(`Forget ${github.app?.name ?? "chef's GitHub app"}? Projects linked through it stop syncing until you connect GitHub again. Delete the app in GitHub's developer settings too.`)) props.onForget();
          }}
        >
          Use another GitHub account
        </button>
      </p>
    </div>
  );
}

function RepositoryForm(props: { readonly project: string; readonly api: ProjectApi; readonly current: GitLinkView | null; readonly save: (update: ProjectSettingsUpdate, done?: string) => Promise<boolean> }) {
  const { current } = props;
  const [source, setSource] = useState<"github" | "other">(current && !current.github ? "other" : "github");
  const [github, setGitHub] = useState<GitHubView | null>(null);
  const [url, setUrl] = useState(current?.url ?? "");
  const [branch, setBranch] = useState(current?.branch ?? "main");
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
        void run({ git: { url: url.trim(), branch: branch.trim(), mode, syncBranch: syncBranch.trim(), ...link } }, current ? "Saved" : "Linked; chef is taking the repository in");
      }}
    >
      {viaGitHub ? (
        <GitHubPicker
          project={props.project}
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
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Main branch" required />
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
          <p className="text-xs text-muted-foreground">{MODES.find((m) => m.mode === mode)?.note} chef never pushes to {branch.trim() || "main"}.</p>
        </>
      ) : null}
      <div className="flex justify-end gap-2">
        {current ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run({ git: null }, "Unlinked; the project stays on chef")}>
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

function PreviewsForm(props: { readonly minutes: number; readonly save: (update: ProjectSettingsUpdate, done?: string) => Promise<boolean> }) {
  const [minutes, setMinutes] = useState(String(props.minutes));
  return (
    <form
      id="project-previews"
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void props.save({ previewIdleMinutes: Number(minutes) });
      }}
    >
      <Field label="Minutes without visits before previews sleep">
        <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Preview idle minutes" type="number" min={5} max={10080} required />
      </Field>
      <Button type="submit" size="sm">
        Save
      </Button>
    </form>
  );
}

export function ProjectSettingsDialog(props: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly project: string; readonly api: ProjectApi; readonly onSaved?: () => void }) {
  const { open, onOpenChange, project, api } = props;
  const [settings, setSettings] = useState<ProjectSettingsView | null>(null);
  useEffect(() => {
    if (open) api.settings().then(setSettings, (e: unknown) => toast.error("Could not load the project settings", { description: e instanceof Error ? e.message : String(e) }));
  }, [open, api]);
  const save = async (update: ProjectSettingsUpdate, done = "Saved") => {
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-dialog="project-settings">
        <DialogHeader>
          <DialogTitle>{project}</DialogTitle>
          <DialogDescription>chef always works on its own copy of the code. Linking a repository is optional and only keeps the two in sync.</DialogDescription>
        </DialogHeader>
        {settings ? (
          <div className="grid gap-5">
            <Section title="Repository (optional)" note="chef takes in every push to the repository's main branch and sends finished features back the way you pick below.">
              <RepositoryForm key={settings.git?.url ?? "none"} project={project} api={api} current={settings.git} save={save} />
            </Section>
            <Section title="Previews" note="A preview starts when someone opens its link, and is removed from your Cloudflare account after it sits unused.">
              <PreviewsForm key={settings.previewIdleMinutes} minutes={settings.previewIdleMinutes} save={save} />
            </Section>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
