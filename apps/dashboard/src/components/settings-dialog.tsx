import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, settingsApi, type SettingsUpdate, type SettingsView, type Source } from "@/lib/api";
import { cn } from "@/lib/utils";

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

export function missingSettings(settings: SettingsView | null): string[] {
  if (!settings) return [];
  return [...(settings.llm ? [] : ["model"]), ...(settings.cloudflare ? [] : ["previews"])];
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    settingsApi.get().then(setSettings, (e: unknown) => {
      if (e instanceof ApiError && e.status === 404) setAvailable(false);
    });
  }, []);
  return { settings, setSettings, available };
}

type Save = (update: SettingsUpdate, done?: string) => Promise<boolean>;

function Current(props: { readonly text: string | null; readonly source?: Source | undefined; readonly name: string }) {
  return (
    <p className="text-xs text-muted-foreground" data-current={props.name} data-set={props.text ? "yes" : "no"}>
      {props.text ? `${props.text}${props.source === "deployment" ? ", from the deployment" : ""}` : "Not set"}
    </p>
  );
}

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

function Actions(props: { readonly busy: boolean; readonly onRemove?: (() => void) | undefined }) {
  return (
    <div className="flex justify-end gap-2">
      {props.onRemove ? (
        <Button type="button" variant="ghost" size="sm" disabled={props.busy} onClick={props.onRemove}>
          Remove
        </Button>
      ) : null}
      <Button type="submit" size="sm" disabled={props.busy}>
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
  const { busy, run } = useBusy(props.save);
  const choice = choices.find((c) => c.kind === kind) ?? (choices[0] as Choice);
  const label = current ? `${choices.find((c) => c.kind === current.kind)?.label ?? current.kind}${current.baseUrl ? ` at ${current.baseUrl}` : ""}, key ${current.keyHint}` : null;
  return (
    <form
      id={`settings-${part}`}
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ [part]: { kind, apiKey: apiKey.trim(), ...(choice.urlHint ? { baseUrl: baseUrl.trim() } : {}) } }).then((ok) => ok && setApiKey(""));
      }}
    >
      <Current name={part} text={label} source={current?.source} />
      <div role="radiogroup" aria-label={part === "llm" ? "Claude provider" : "Voice provider"} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {choices.map((c) => (
          <button key={c.kind} type="button" role="radio" aria-checked={kind === c.kind} onClick={() => setKind(c.kind)} className={cn("rounded-md px-2 py-1.5 text-xs", kind === c.kind ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {c.label}
          </button>
        ))}
      </div>
      {choice.urlHint ? <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={choice.urlHint} aria-label="Base URL" type="url" required /> : null}
      <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={current ? "Enter a new key to replace the current one" : choice.keyLabel} aria-label={choice.keyLabel} type="password" autoComplete="off" required />
      <Actions busy={busy} onRemove={current?.source === "app" ? () => void run({ [part]: null }, "Removed") : undefined} />
    </form>
  );
}

function ModelsForm(props: { readonly settings: SettingsView; readonly save: Save }) {
  const { models, attempts } = props.settings;
  const [planner, setPlanner] = useState(models.planner);
  const [reviewer, setReviewer] = useState(models.reviewer);
  const [coder, setCoder] = useState(models.coder);
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
        void run({ models: { planner: planner.trim(), reviewer: reviewer.trim(), coder: coder.trim() }, attempts: Number(count) });
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {field("Planner model", planner, setPlanner)}
        {field("Reviewer model", reviewer, setReviewer)}
        {field("Coder model", coder, setCoder)}
      </div>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Parallel tries per feature
        <Input value={count} onChange={(e) => setCount(e.target.value)} aria-label="Parallel attempts" type="number" min={1} max={4} required />
        <span>With more than 1, chef builds each new feature that many ways at once and keeps the one that passes the most checks. Each try costs as much as a whole build.</span>
      </label>
      <Actions busy={busy} onRemove={models.source === "app" || attempts.source === "app" ? () => void run({ models: null, attempts: null }, "Back to the defaults") : undefined} />
    </form>
  );
}

function CloudflareForm(props: { readonly settings: SettingsView; readonly save: Save }) {
  const current = props.settings.cloudflare;
  const [accountId, setAccountId] = useState(current?.accountId ?? "");
  const [apiToken, setApiToken] = useState("");
  const { busy, run } = useBusy(props.save);
  return (
    <form
      id="settings-cloudflare"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ cloudflare: { accountId: accountId.trim(), apiToken: apiToken.trim() } }).then((ok) => ok && setApiToken(""));
      }}
    >
      <Current name="cloudflare" text={current ? `Account ${current.accountId}, token ${current.keyHint}` : null} source={current?.source} />
      <Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Account id" aria-label="Account id" required />
      <Input value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder={current ? "Enter a new token to replace the current one" : "API token that can edit Workers"} aria-label="API token" type="password" autoComplete="off" required />
      <Actions busy={busy} onRemove={current?.source === "app" ? () => void run({ cloudflare: null }, "Removed") : undefined} />
    </form>
  );
}

function JevForm(props: { readonly settings: SettingsView; readonly save: Save }) {
  const current = props.settings.jev;
  const [apiKey, setApiKey] = useState("");
  const { busy, run } = useBusy(props.save);
  return (
    <form
      id="settings-jev"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ jev: { apiKey: apiKey.trim() } }).then((ok) => ok && setApiKey(""));
      }}
    >
      <Current name="jev" text={current ? `TypeSafe key ${current.keyHint}` : null} source={current?.source} />
      <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={current ? "Enter a new key to replace the current one" : "TypeSafe API key"} aria-label="TypeSafe API key" type="password" autoComplete="off" required />
      <Actions busy={busy} onRemove={current?.source === "app" ? () => void run({ jev: null }, "Removed") : undefined} />
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

const TABS = [
  { value: "model", label: "Model" },
  { value: "previews", label: "Previews" },
  { value: "voice", label: "Voice" },
  { value: "routing", label: "Routing" },
  { value: "password", label: "Password" },
] as const;

export function SettingsDialog(props: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly settings: SettingsView | null; readonly onChange: (settings: SettingsView) => void }) {
  const { open, onOpenChange, settings, onChange } = props;
  const missing = missingSettings(settings);
  const [tab, setTab] = useState<string>(missing[0] ?? "model");
  useEffect(() => {
    if (open && missing[0]) setTab(missing[0]);
  }, [open]);
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-dialog="settings">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>{missing.length > 0 ? "chef needs a model and a Cloudflare account before it can build. Keys stay on your chef; only their last four characters come back here." : "Keys stay on your chef; only their last four characters come back here."}</DialogDescription>
        </DialogHeader>
        {settings ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-9 w-full">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="px-2 text-xs" data-missing={missing.includes(t.value) ? "yes" : undefined}>
                  {t.label}
                  {missing.includes(t.value) ? <span className="ml-1 size-1.5 rounded-full bg-bad" aria-label="needs setup" /> : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="model" className="grid gap-5 pt-3">
              <Section title="Claude" note="Plans, writes and reviews code. Use your Anthropic API key, or any Anthropic-compatible provider with its base URL and key.">
                <ProviderForm key={`llm-${settings.llm?.kind ?? "none"}`} part="llm" choices={MODEL_CHOICES} current={settings.llm} save={save} />
              </Section>
              <Section title="Models" note="Model ids your provider accepts, and how many attempts race on each new feature.">
                <ModelsForm key={JSON.stringify([settings.models, settings.attempts])} settings={settings} save={save} />
              </Section>
            </TabsContent>
            <TabsContent value="previews" className="pt-3">
              <Section title="Cloudflare" note="Every feature gets a live preview on your Cloudflare account. The token needs permission to edit Workers.">
                <CloudflareForm key={settings.cloudflare?.accountId ?? "none"} settings={settings} save={save} />
              </Section>
            </TabsContent>
            <TabsContent value="voice" className="pt-3">
              <Section title="Voice (optional)" note="Talk to chef. Needs an OpenAI key, or a provider that serves the OpenAI Realtime API.">
                <ProviderForm key={`voice-${settings.voice?.kind ?? "none"}`} part="voice" choices={VOICE_CHOICES} current={settings.voice} save={save} />
              </Section>
            </TabsContent>
            <TabsContent value="routing" className="pt-3">
              <Section title="Fast routing (optional)" note="A TypeSafe key lets Jev decide in about 100ms whether a request is a new feature, a change or a question. Without it Claude decides.">
                <JevForm settings={settings} save={save} />
              </Section>
            </TabsContent>
            <TabsContent value="password" className="pt-3">
              <Section title="Password" note="Changing it signs out every other browser and script.">
                <PasswordForm settings={settings} save={save} />
              </Section>
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
