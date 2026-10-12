import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError, settingsApi, type ProviderInput, type ProviderView, type SettingsView } from "@/lib/api";
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

function describe(view: ProviderView | null, choices: readonly Choice[]): string {
  if (!view) return "Not set";
  const label = choices.find((c) => c.kind === view.kind)?.label ?? view.kind;
  const where = view.baseUrl ? ` at ${view.baseUrl}` : "";
  return `${label}${where}, key ${view.keyHint}${view.source === "deployment" ? ", from the deployment" : ""}`;
}

function ProviderForm(props: { readonly id: string; readonly title: string; readonly note: string; readonly choices: readonly Choice[]; readonly current: ProviderView | null; readonly onSave: (input: ProviderInput) => Promise<void> }) {
  const { id, title, note, choices, current, onSave } = props;
  const [kind, setKind] = useState(current?.kind ?? (choices[0] as Choice).kind);
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const choice = choices.find((c) => c.kind === kind) ?? (choices[0] as Choice);
  const save = async (input: ProviderInput) => {
    setBusy(true);
    try {
      await onSave(input);
      setApiKey("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      id={id}
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ kind, apiKey: apiKey.trim(), ...(choice.urlHint ? { baseUrl: baseUrl.trim() } : {}) });
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="truncate text-xs text-muted-foreground" data-current={current?.kind ?? "none"}>
          {describe(current, choices)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{note}</p>
      <div role="radiogroup" aria-label={title} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {choices.map((c) => (
          <button key={c.kind} type="button" role="radio" aria-checked={kind === c.kind} onClick={() => setKind(c.kind)} className={cn("rounded-md px-2 py-1.5 text-xs", kind === c.kind ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {c.label}
          </button>
        ))}
      </div>
      {choice.urlHint ? <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={choice.urlHint} aria-label="Base URL" type="url" required /> : null}
      <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={current ? "Enter a new key to replace the current one" : choice.keyLabel} aria-label={choice.keyLabel} type="password" autoComplete="off" required />
      <div className="flex justify-end gap-2">
        {current?.source === "app" ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void save(null)}>
            Remove
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
      </div>
    </form>
  );
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

export function ProviderSettings(props: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly settings: SettingsView | null; readonly onChange: (settings: SettingsView) => void }) {
  const { open, onOpenChange, settings, onChange } = props;
  const save = (part: "llm" | "voice") => async (input: ProviderInput) => {
    try {
      onChange(await settingsApi.save({ [part]: input }));
      toast.success(input ? "Saved" : "Removed");
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-dialog="providers">
        <DialogHeader>
          <DialogTitle>Model provider</DialogTitle>
          <DialogDescription>chef plans, writes and reviews code with Claude. Use your own Anthropic API key, or any Anthropic-compatible provider with its base URL and key.</DialogDescription>
        </DialogHeader>
        <ProviderForm key={`llm-${settings?.llm?.kind ?? "none"}`} id="provider-llm" title="Claude" note="Used by the planner, the reviewer and the coder." choices={MODEL_CHOICES} current={settings?.llm ?? null} onSave={save("llm")} />
        <div className="border-t" />
        <ProviderForm key={`voice-${settings?.voice?.kind ?? "none"}`} id="provider-voice" title="Voice (optional)" note="Talk to chef. Needs an OpenAI key, or a provider that serves the OpenAI Realtime API." choices={VOICE_CHOICES} current={settings?.voice ?? null} onSave={save("voice")} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
