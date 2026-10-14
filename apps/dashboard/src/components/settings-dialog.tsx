import { useEffect, useState, type ReactNode } from "react";
import { Bot, BookOpen, Cloud, Cpu, GitBranch, KeyRound, Route, ScrollText, SlidersHorizontal } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentsSection, type AgentSection, type AgentsNav } from "@/components/agents-view";
import { EnvironmentForm } from "@/components/environment";
import { SecretField } from "@/components/secret-field";
import { SharedInstructionsForm } from "@/components/guidance";
import { Group, SettingsShell, type SettingsSection } from "@/components/settings-shell";
import { appApi, githubApi, orgApi, settingsApi, sharedEnvApi, type GitHubView, type OrgView, type SettingsUpdate, type SettingsView, type Source } from "@/lib/api";
import { missingSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { orgLabel, PLAN_LABEL, useAppMode } from "@/lib/account";

interface Choice {
  readonly kind: string;
  readonly label: string;
  readonly keyLabel: string;
  readonly urlHint?: string;
}

const MODEL_CHOICES: readonly Choice[] = [
  { kind: "anthropic", label: "Anthropic API key", keyLabel: "Anthropic API key" },
  { kind: "custom", label: "Custom provider", keyLabel: "API key", urlHint: "https://your-provider.example" },
];

const VOICE_CHOICES: readonly Choice[] = [
  { kind: "openai", label: "OpenAI API key", keyLabel: "OpenAI API key" },
  { kind: "custom", label: "Custom provider", keyLabel: "API key", urlHint: "https://your-provider.example/v1" },
];

type Save = (update: SettingsUpdate, done?: string) => Promise<boolean>;

function FromDeployment(props: { readonly source: Source | undefined; readonly what: string }) {
  return props.source === "deployment" ? <p className="text-xs text-muted-foreground">{`This ${props.what} comes from the deployment. One saved here takes its place.`}</p> : null;
}

function Actions(props: { readonly busy: boolean; readonly onRemove?: (() => void) | undefined; readonly idle?: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      {props.onRemove ? (
        <Button type="button" variant="ghost" size="sm" disabled={props.busy} onClick={props.onRemove}>
          Remove
        </Button>
      ) : null}
      <Button type="submit" size="sm" disabled={props.busy || props.idle === true}>
        Save
      </Button>
    </div>
  );
}

function useBusy(save: Save) {
  const [busy, setBusy] = useState(false);
  const run = async (update: SettingsUpdate, done?: string) => {
    setBusy(true);
    try {
      return await save(update, done);
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function ProviderForm(props: { readonly part: "llm" | "voice"; readonly choices: readonly Choice[]; readonly current: SettingsView["llm"]; readonly save: Save }) {
  const { part, choices, current } = props;
  const [kind, setKind] = useState(current?.kind ?? (choices[0] as Choice).kind);
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const { busy, run } = useBusy(props.save);
  const choice = choices.find((c) => c.kind === kind) ?? (choices[0] as Choice);
  const bare = (url: string) => url.trim().replace(/\/+$/, "");
  const moved = current !== null && (kind !== current.kind || (choice.urlHint !== undefined && bare(baseUrl) !== bare(current.baseUrl ?? "")));
  const reenter = moved ? "A new provider needs its key again." : null;
  return (
    <form
      id={`settings-${part}`}
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ [part]: { kind, apiKey: apiKey.trim(), ...(choice.urlHint ? { baseUrl: baseUrl.trim() } : {}) } }).then((ok) => ok && (setApiKey(""), setReplacing(false)));
      }}
    >
      <div role="radiogroup" aria-label={part === "llm" ? "Claude provider" : "Voice provider"} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {choices.map((c) => (
          <button key={c.kind} type="button" role="radio" aria-checked={kind === c.kind} onClick={() => setKind(c.kind)} className={cn("rounded-md px-2 py-1.5 text-xs", kind === c.kind ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {c.label}
          </button>
        ))}
      </div>
      {choice.urlHint ? <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={choice.urlHint} aria-label="Base URL" type="url" required /> : null}
      <SecretField name={part} label={choice.keyLabel} hint={current?.keyHint ?? null} value={apiKey} onChange={setApiKey} editing={replacing} onEditing={setReplacing} reenter={reenter} />
      <FromDeployment source={current?.source} what="key" />
      <Actions busy={busy} idle={current !== null && !replacing && !moved} onRemove={current?.source === "app" ? () => void run({ [part]: null }, "Removed") : undefined} />
    </form>
  );
}

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
        <span>With more than 1, chef builds each new feature that many ways at once and keeps the one that passes the most checks. Each try costs as much as a whole build. A project can set its own number.</span>
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
      <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password, at least 8 characters" aria-label="New password" type="password" autoComplete="new-password" minLength={8} required />
      <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="The same password again" aria-label="Repeat the password" type="password" autoComplete="new-password" required />
      <Actions busy={busy} />
    </form>
  );
}

function ChangePlace(props: { readonly note: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">{props.note}</p>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            appApi.disconnect().then(
              () => location.reload(),
              (e: unknown) => {
                setBusy(false);
                toast.error("Could not change it", { description: e instanceof Error ? e.message : String(e) });
              },
            );
          }}
        >
          Choose where chef works
        </Button>
      </div>
    </div>
  );
}

function ComputerSection(props: { readonly settings: SettingsView }) {
  const mode = useAppMode();
  return (
    <Group title="This computer" note="Everything runs here: projects, agents, sandboxes and previews. Only this computer can open chef, so it has no password. Work pauses while the computer sleeps.">
      <p className="text-xs text-muted-foreground" data-current="data-dir">
        Data is kept in {props.settings.dataDir}
      </p>
      {mode && !mode.fixed ? <ChangePlace note="To keep this computer light and let work go on while it sleeps, move the work to Cloudflare. Projects made here stay on this computer and come back when you switch back." /> : null}
    </Group>
  );
}

function AccountSection(props: { readonly account: string | null; readonly admin: boolean }) {
  return (
    <Group title="Account" note="You signed in with Cloudflare. chef works in your Cloudflare account, and this site keeps only its address. Sign out from the menu at the bottom left.">
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground" data-current="account">
          {props.account ? `Signed in as ${props.account}` : "Signed in with Cloudflare"}
        </p>
        {props.admin ? (
          <Button asChild size="sm" variant="outline">
            <a href="/admin">Members</a>
          </Button>
        ) : null}
      </div>
    </Group>
  );
}

const ROLE_LABEL = { owner: "an owner", admin: "an admin", member: "a member" } as const;

function OrgSection(props: { readonly org: OrgView }) {
  const [name, setName] = useState(props.org.name);
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    try {
      await work();
      after();
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const note = props.org.personal
    ? "Your own workspace. Its chef, projects and Cloudflare account are yours alone. Switch workspaces from the menu at the bottom left."
    : `This organization owns its chef, its projects and the Cloudflare account it runs on. You are ${ROLE_LABEL[props.org.role]} of it. Switch workspaces from the menu at the bottom left.`;
  return (
    <Group title="Workspace" note={note}>
      {props.org.personal || props.org.role === "member" ? (
        <p className="text-sm" data-current="org">
          {orgLabel(props.org)} · {PLAN_LABEL[props.org.plan]}
        </p>
      ) : (
        <form
          className="grid gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => orgApi.rename(name), () => toast.success("Organization renamed"));
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Organization name" maxLength={60} required data-current="org" />
          <Actions busy={busy} />
        </form>
      )}
      <form
        id="new-org"
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => orgApi.create(fresh), () => location.assign("/setup"));
        }}
      >
        <Input value={fresh} onChange={(e) => setFresh(e.target.value)} placeholder="New organization name" aria-label="New organization name" maxLength={60} required />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          Create organization
        </Button>
      </form>
    </Group>
  );
}

function ConnectionForm() {
  const mode = useAppMode();
  if (!mode || mode.mode !== "local" || mode.place !== "cloud") return null;
  return (
    <Group title="This computer" note="The app runs here and talks to your chef in the cloud, where the work runs.">
      <p className="text-xs text-muted-foreground" data-current="engine">
        Connected to {mode.engine}
        {mode.fixed ? ", set by CHEF_URL" : ""}
      </p>
      {mode.fixed ? null : <ChangePlace note="You can run everything on this computer instead, or connect to another chef. Your projects stay in this chef in Cloudflare." />}
    </Group>
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
      <Group title="Not connected" note="Connect once and every project can link a GitHub repository by picking it from a list. GitHub asks you to create chef's own app for this deployment, then to pick the repositories it may use.">
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
    <Group title="Connected" note={`chef uses its own GitHub app, ${app.name}, owned by ${app.owner}. Projects link a repository in Project settings > Repository.`}>
      <div className="grid gap-2" data-github="connected">
        <p className="text-xs text-muted-foreground">{github.repositories.length === 1 ? "1 repository is" : `${github.repositories.length} repositories are`} shared with chef.</p>
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
}) {
  const { settings, onChange, nav } = props;
  const missing = missingSettings(settings);
  const computer = settings?.runsOn === "computer";
  const mode = useAppMode();
  const hosted = mode?.account !== undefined;
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
  const needsSettings = new Set(["models", "previews"]);
  const all: SettingsSection[] = [
    {
      id: "general",
      label: "General",
      icon: SlidersHorizontal,
      note: "How chef looks and who can open it.",
      render: () => (
        <>
          <Group title="Theme">
            <ThemeChoice />
          </Group>
          {settings && computer ? <ComputerSection settings={settings} /> : null}
          {hosted ? <AccountSection account={mode?.account ?? null} admin={mode?.admin === true} /> : null}
          {hosted && mode?.org ? <OrgSection org={mode.org} /> : null}
          {settings && !computer && !hosted ? (
            <Group title="Password" note="Changing it signs out every other browser and script.">
              <PasswordForm settings={settings} save={save} />
            </Group>
          ) : null}
          {computer ? null : <ConnectionForm />}
        </>
      ),
    },
    {
      id: "models",
      label: "Models",
      icon: Cpu,
      attention: missing.includes("models"),
      note: `The provider and models every project uses. Keys stay ${computer ? "on this computer" : "on your chef"}; only their last four characters come back here.`,
      render: () =>
        settings ? (
          <>
            <Group title="Claude" note="Plans, writes and reviews code. Use your Anthropic API key, or any Anthropic-compatible provider with its base URL and key.">
              <ProviderForm key={`llm-${settings.llm?.kind ?? "none"}`} part="llm" choices={MODEL_CHOICES} current={settings.llm} save={save} />
            </Group>
            <Group title="Models" note="Model ids your providers accept, and how many tries race on each new feature. The voice model is the one you talk to in live talk. A role can pick its own model in Agents.">
              <ModelsForm key={JSON.stringify([settings.models, settings.attempts])} settings={settings} save={save} />
            </Group>
            <Group title="Voice (optional)" note="Live talk with chef. Use an OpenAI key, or a provider that serves the OpenAI Realtime API.">
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
      note: "Keys and settings every project's app gets at runtime. A project can set its own value for any of them. Previews get the values; agents only see the names.",
      render: () => <EnvironmentForm api={sharedEnvApi} />,
    },
    {
      id: "previews",
      label: "Previews",
      icon: Cloud,
      attention: missing.includes("previews"),
      note: computer ? "Every feature gets a live preview in Docker on this computer. No Cloudflare account is needed." : "Every feature gets a live preview on your Cloudflare account.",
      render: () =>
        settings && computer ? (
          <p className="text-xs text-muted-foreground" data-current="previews">
            Previews start when you open them and stop after they sit idle.
          </p>
        ) : settings ? (
          <Group title="Cloudflare" note="The token needs permission to edit Workers.">
            <CloudflareForm key={settings.cloudflare?.accountId ?? "none"} settings={settings} save={save} />
          </Group>
        ) : (
          loading()
        ),
    },
    { id: "github", label: "GitHub", icon: GitBranch, note: "One connection for every project that links a GitHub repository.", render: () => <GitHubSection returnTo={props.returnTo} /> },
  ];
  const sections = all.filter((s) => props.available || !needsSettings.has(s.id));
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
