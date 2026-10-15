import { useEffect, useState, type ReactNode } from "react";
import { Bot, BookOpen, Cloud, Cpu, GitBranch, Key, KeyRound, Route, ScrollText, SlidersHorizontal, Wallet } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentsSection, type AgentSection, type AgentsNav } from "@/components/agents-view";
import { EnvironmentForm } from "@/components/environment";
import { SecretField } from "@/components/secret-field";
import { Actions, FromDeployment, MODEL_CHOICES, ProviderForm, useBusy, VOICE_CHOICES, type Save } from "@/components/provider-form";
import { SharedInstructionsForm } from "@/components/guidance";
import { Group, SettingsShell, type SettingsSection } from "@/components/settings-shell";
import { githubApi, settingsApi, sharedEnvApi, type GitHubView, type SettingsView } from "@/lib/api";
import { missingSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { UsageSection } from "@/components/usage";
import { ApiKeysSection } from "@/components/api-keys";
import { host } from "@/host";

function ModelsForm(props: { readonly settings: SettingsView; readonly save: Save }) {
  const { models, attempts } = props.settings;
  const [planner, setPlanner] = useState(models.planner);
  const [reviewer, setReviewer] = useState(models.reviewer);
  const [coder, setCoder] = useState(models.coder);
  const [voice, setVoice] = useState(models.voice);
  const [count, setCount] = useState(String(attempts.value));
  const { busy, run } = useBusy(props.save);
  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input value={value} onChange={(e) => set(e.target.value)} aria-label={label} required />
    </label>
  );
  return (
    <form
      id="settings-models"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ models: { planner: planner.trim(), reviewer: reviewer.trim(), coder: coder.trim(), voice: voice.trim() }, attempts: Number(count) });
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {field("Planner model", planner, setPlanner)}
        {field("Reviewer model", reviewer, setReviewer)}
        {field("Coder model", coder, setCoder)}
      </div>
      <div className="grid grid-cols-3 gap-2">{field("Voice model", voice, setVoice)}</div>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Parallel tries per feature
        <Input value={count} onChange={(e) => setCount(e.target.value)} aria-label="Parallel attempts" type="number" min={1} max={4} required />
        <span>With more than 1, Chef builds each new feature that many ways at once and keeps the one that passes the most checks. Each try costs as much as a whole build. A project can set its own number.</span>
      </label>
      <Actions busy={busy} onRemove={models.source === "app" || attempts.source === "app" ? () => void run({ models: null, attempts: null }, "Back to the defaults") : undefined} />
    </form>
  );
}

function CloudflareForm(props: { readonly settings: SettingsView; readonly save: Save }) {
  const current = props.settings.cloudflare;
  const [accountId, setAccountId] = useState(current?.accountId ?? "");
  const [apiToken, setApiToken] = useState("");
  const [replacing, setReplacing] = useState(false);
  const { busy, run } = useBusy(props.save);
  const moved = current !== null && accountId.trim() !== current.accountId;
  return (
    <form
      id="settings-cloudflare"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ cloudflare: { accountId: accountId.trim(), apiToken: apiToken.trim() } }).then((ok) => ok && (setApiToken(""), setReplacing(false)));
      }}
    >
      <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Account id" aria-label="Account id" required />
      <SecretField name="cloudflare" label={current ? "API token" : "API token that can edit Workers"} hint={current?.keyHint ?? null} value={apiToken} onChange={setApiToken} editing={replacing} onEditing={setReplacing} reenter={moved ? "Another account needs its own token." : null} />
      <FromDeployment source={current?.source} what="token" />
      <Actions busy={busy} idle={current !== null && !replacing && !moved} onRemove={current?.source === "app" ? () => void run({ cloudflare: null }, "Removed") : undefined} />
    </form>
  );
}

function JevForm(props: { readonly settings: SettingsView; readonly save: Save }) {
  const current = props.settings.jev;
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const { busy, run } = useBusy(props.save);
  return (
    <form
      id="settings-jev"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ jev: { apiKey: apiKey.trim() } }).then((ok) => ok && (setApiKey(""), setReplacing(false)));
      }}
    >
      <SecretField name="jev" label="TypeSafe API key" hint={current?.keyHint ?? null} value={apiKey} onChange={setApiKey} editing={replacing} onEditing={setReplacing} />
      <FromDeployment source={current?.source} what="key" />
      <Actions busy={busy} idle={current !== null && !replacing} onRemove={current?.source === "app" ? () => void run({ jev: null }, "Removed") : undefined} />
    </form>
  );
}

function PasswordForm(props: { readonly settings: SettingsView; readonly save: Save }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, run } = useBusy(props.save);
  if (props.settings.password === "deployment") return <p className="text-xs text-muted-foreground">The password comes from the deployment's CHEF_PASSWORD secret. Change it there.</p>;
  const none = props.settings.password === "none";
  return (
    <form
      id="settings-password"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (password !== confirm) {
          toast.error("The two passwords differ");
          return;
        }
        void run({ password }, "Password changed").then((ok) => ok && (setPassword(""), setConfirm("")));
      }}
    >
      {none ? <p className="text-xs text-muted-foreground">No password yet, so no one can sign in from a browser.</p> : null}
      <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password, at least 8 characters" aria-label="New password" type="password" autoComplete="new-password" minLength={8} required />
      <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="The same password again" aria-label="Repeat the password" type="password" autoComplete="new-password" required />
      <Actions busy={busy} />
    </form>
  );
}

function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid w-fit grid-cols-3 gap-1 rounded-lg bg-muted p-1">
      {(["light", "dark", "system"] as const).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={(theme ?? "system") === t} onClick={() => setTheme(t)} className={cn("rounded-md px-3 py-1.5 text-xs capitalize", (theme ?? "system") === t ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {t}
        </button>
      ))}
    </div>
  );
}

function GitHubSection(props: { readonly returnTo: string }) {
  const [github, setGitHub] = useState<GitHubView | null>(null);
  const [organization, setOrganization] = useState("");
  useEffect(() => {
    githubApi.get().then(setGitHub, (e: unknown) => setGitHub({ app: null, repositories: [], error: e instanceof Error ? e.message : String(e) }));
  }, []);
  if (!github) return <p className="text-xs text-muted-foreground">Checking GitHub…</p>;
  if (!github.app)
    return (
      <Group title="Not connected" note="Connect once and every project can link a GitHub repository by picking it from a list. GitHub asks you to create Chef's own app for this deployment, then to pick the repositories it may use.">
        <div className="grid gap-2" data-github="none">
          <label className="grid gap-1 text-xs text-muted-foreground">
            GitHub organization that owns the repositories (leave empty for your own account)
            <Input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="your-org" aria-label="GitHub organization" autoComplete="off" />
          </label>
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={() => location.assign(githubApi.connectUrl(props.returnTo, organization.trim() || undefined))}>
              Connect GitHub
            </Button>
          </div>
        </div>
      </Group>
    );
  const app = github.app;
  return (
    <Group title="Connected" note={`Chef uses its own GitHub app, ${app.name}, owned by ${app.owner}. Projects link a repository in Project settings > Repository.`}>
      <div className="grid gap-2" data-github="connected">
        <p className="text-xs text-muted-foreground">{github.repositories.length === 1 ? "1 repository is" : `${github.repositories.length} repositories are`} shared with Chef.</p>
        <ul className="grid max-h-48 gap-px overflow-y-auto rounded-lg border p-1 text-xs">
          {github.repositories.map((r) => (
            <li key={r.fullName} className="truncate px-2 py-1">
              {r.fullName}
            </li>
          ))}
          {github.repositories.length === 0 ? <li className="px-2 py-1 text-muted-foreground">{github.error ?? "None yet."}</li> : null}
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!confirm(`Forget ${app.name}? Projects linked through it stop syncing until you connect GitHub again. Delete the app in GitHub's developer settings too.`)) return;
              githubApi.forget().then(setGitHub, (e: unknown) => toast.error("Could not forget the app", { description: e instanceof Error ? e.message : String(e) }));
            }}
          >
            Use another account
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => location.assign(githubApi.connectUrl(props.returnTo))}>
            Add repositories on GitHub
          </Button>
        </div>
      </div>
    </Group>
  );
}

export function SettingsDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly settings: SettingsView | null;
  readonly available: boolean;
  readonly onChange: (settings: SettingsView) => void;
  readonly section: string;
  readonly item: string | null;
  readonly nav: AgentsNav & { readonly section: (section: string) => void };
  readonly returnTo: string;
  readonly locked?: boolean;
}) {
  const { settings, onChange, nav } = props;
  const missing = missingSettings(settings);
  const save: Save = async (update, done = "Saved") => {
    try {
      onChange(await settingsApi.save(update));
      toast.success(done);
      return true;
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };
  const loading = () => <p className="text-xs text-muted-foreground">Loading…</p>;
  const jev = settings ? (
    <Group title="Fast routing with Jev (optional)" note="A TypeSafe key lets Jev decide in about 100ms. Without it Claude decides.">
      <JevForm settings={settings} save={save} />
    </Group>
  ) : null;
  const agents = (section: AgentSection, before?: ReactNode) => () => <AgentsSection project={null} section={section} item={props.item} nav={nav} before={before} />;
  const needsSettings = new Set(["models", "apps"]);
  const all: SettingsSection[] = [
    {
      id: "general",
      label: "General",
      icon: SlidersHorizontal,
      note: host.generalNote ?? "How Chef looks and who can open it.",
      render: () => (
        <>
          <Group title="Theme">
            <ThemeChoice />
          </Group>
          {host.General ? <host.General locked={props.locked === true} /> : null}
          {settings && !host.General ? (
            <Group title="Password" note="For signing in from a browser. Changing it signs out every other browser.">
              <PasswordForm settings={settings} save={save} />
            </Group>
          ) : null}
        </>
      ),
    },
    {
      id: "usage",
      label: "Usage",
      icon: Wallet,
      note: "What Chef spends on models this month, and the budgets that pause work when they are reached.",
      render: () => <UsageSection />,
    },
    {
      id: "models",
      label: "Models",
      icon: Cpu,
      attention: missing.includes("models"),
      note: "The provider and models every project uses. Keys stay on your Chef; only their last four characters come back here.",
      render: () =>
        settings ? (
          <>
            <Group title="Claude" note="Plans, writes and reviews code. Use your Anthropic API key, or any Anthropic-compatible provider with its base URL and key.">
              <ProviderForm key={`llm-${settings.llm?.kind ?? "none"}`} part="llm" choices={MODEL_CHOICES} current={settings.llm} save={save} />
            </Group>
            <Group title="Models" note="Model ids your providers accept, and how many tries race on each new feature. The voice model is the one you talk to in live talk. A role can pick its own model in Agents.">
              <ModelsForm key={JSON.stringify([settings.models, settings.attempts])} settings={settings} save={save} />
            </Group>
            <Group title="Voice (optional)" note="Live talk with Chef. Use an OpenAI key, or a provider that serves the OpenAI Realtime API.">
              <ProviderForm key={`voice-${settings.voice?.kind ?? "none"}`} part="voice" choices={VOICE_CHOICES} current={settings.voice} save={save} />
            </Group>
          </>
        ) : (
          loading()
        ),
    },
    {
      id: "instructions",
      label: "Instructions",
      icon: ScrollText,
      note: "Every agent in every project follows these, on top of its role. Each project can add its own goal and instructions in its project settings.",
      render: () => <SharedInstructionsForm />,
    },
    { id: "agents", label: "Agents", icon: Bot, fill: true, render: agents("agents") },
    { id: "skills", label: "Skills", icon: BookOpen, fill: true, render: agents("skills") },
    {
      id: "router",
      label: "Router",
      icon: Route,
      fill: true,
      render: agents("router", <div className="mx-auto max-w-3xl px-4 pt-5 sm:px-6"><div className="rounded-xl border p-4">{jev}</div></div>),
    },
    {
      id: "environment",
      label: "Environment",
      icon: KeyRound,
      note: "Keys and settings every project's app gets at runtime. A project can set its own value for any of them. Running apps get the values; agents only see the names.",
      render: () => <EnvironmentForm api={sharedEnvApi} />,
    },
    {
      id: "apps",
      label: "Apps",
      icon: Cloud,
      attention: missing.includes("apps"),
      note: "Each branch runs its app in its own sandbox on your Cloudflare account, and Chef's router gives every running app its own address.",
      render: () =>
        settings ? (
          <Group title="Cloudflare" note="The token needs permission to edit Workers.">
            <CloudflareForm key={settings.cloudflare?.accountId ?? "none"} settings={settings} save={save} />
          </Group>
        ) : (
          loading()
        ),
    },
    { id: "github", label: "GitHub", icon: GitBranch, note: "One connection for every project that links a GitHub repository.", render: () => <GitHubSection returnTo={props.returnTo} /> },
    { id: "api-keys", label: "API keys", icon: Key, note: "Keys for scripts and apps that use Chef without a browser.", render: () => <ApiKeysSection /> },
  ];
  const hidden = new Set(host.hiddenSections ?? []);
  const sections = all
    .filter((s) => (props.available || !needsSettings.has(s.id)) && !hidden.has(s.id))
    .map((s) => (props.locked && s.id !== "general" ? { ...s, fill: false, attention: false, render: () => (host.LockedSection ? <host.LockedSection /> : null) } : s));
  return (
    <SettingsShell
      open={props.open}
      onOpenChange={props.onOpenChange}
      name="settings"
      kicker="For every project"
      heading="Settings"
      description="Settings and defaults that apply to every project"
      sections={sections}
      active={props.section}
      onSelect={nav.section}
    />
  );
}
