import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecretField } from "@/components/secret-field";
import type { SettingsUpdate, SettingsView, Source } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface Choice {
  readonly kind: string;
  readonly label: string;
  readonly keyLabel: string;
  readonly urlHint?: string;
}

export const MODEL_CHOICES: readonly Choice[] = [
  { kind: "anthropic", label: "Anthropic API key", keyLabel: "Anthropic API key" },
  { kind: "custom", label: "Custom provider", keyLabel: "API key", urlHint: "https://your-provider.example" },
];

export const VOICE_CHOICES: readonly Choice[] = [
  { kind: "openai", label: "OpenAI API key", keyLabel: "OpenAI API key" },
  { kind: "custom", label: "Custom provider", keyLabel: "API key", urlHint: "https://your-provider.example/v1" },
];

export type Save = (update: SettingsUpdate, done?: string) => Promise<boolean>;

export function FromDeployment(props: { readonly source: Source | undefined; readonly what: string }) {
  return props.source === "deployment" ? <p className="text-xs text-muted-foreground">{`This ${props.what} comes from the deployment. One saved here takes its place.`}</p> : null;
}

export function Actions(props: { readonly busy: boolean; readonly onRemove?: (() => void) | undefined; readonly idle?: boolean; readonly submit?: string | undefined }) {
  if (props.submit)
    return (
      <Button type="submit" disabled={props.busy || props.idle === true}>
        {props.submit}
      </Button>
    );
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

export function useBusy(save: Save) {
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

export function ProviderForm(props: { readonly part: "llm" | "voice"; readonly choices: readonly Choice[]; readonly current: SettingsView["llm"]; readonly save: Save; readonly submit?: string }) {
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
      <Actions busy={busy} idle={current !== null && !replacing && !moved} onRemove={current?.source === "app" ? () => void run({ [part]: null }, "Removed") : undefined} submit={props.submit} />
    </form>
  );
}
