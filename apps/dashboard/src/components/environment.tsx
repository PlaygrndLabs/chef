import { useEffect, useState } from "react";
import { KeyRound, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ENV_NAME, parseDotEnv } from "@chef/core/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { maskedKey } from "@/components/secret-field";
import type { EnvApi, EnvUpdate, EnvVarView, ProjectEnvView } from "@/lib/api";
import { ToneBadge } from "@/components/status";
import { cn } from "@/lib/utils";

function useSave(api: EnvApi, onSaved: (view: ProjectEnvView) => void) {
  const [busy, setBusy] = useState(false);
  const save = async (update: EnvUpdate, done: string) => {
    setBusy(true);
    try {
      onSaved(await api.saveEnv(update));
      toast.success(done);
      return true;
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, save };
}

function KindToggle(props: { readonly secret: boolean; readonly onChange: (secret: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="Kind" className="grid shrink-0 grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5">
      {[
        { secret: true, label: "Secret" },
        { secret: false, label: "Plain" },
      ].map((k) => (
        <button key={k.label} type="button" role="radio" aria-checked={props.secret === k.secret} onClick={() => props.onChange(k.secret)} className={cn("px-2 py-1 text-xs", props.secret === k.secret ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {k.label}
        </button>
      ))}
    </div>
  );
}

function VarRow(props: { readonly item: EnvVarView; readonly api: EnvApi; readonly onSaved: (view: ProjectEnvView) => void }) {
  const { item } = props;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.value ?? "");
  const { busy, save } = useSave(props.api, props.onSaved);
  return (
    <li className="grid gap-1.5 py-2" data-env-var={item.name}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.name}</span>
        {item.scope === "shared" ? <ToneBadge tone="idle">all projects</ToneBadge> : item.scope === "overrides" ? <ToneBadge tone="run">this project</ToneBadge> : null}
        <span className="text-[11px] text-muted-foreground">{item.secret ? "Secret" : "Plain"}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
          {editing ? "Cancel" : item.scope === "shared" ? "Change here" : item.secret ? "Replace" : "Edit"}
        </Button>
        {item.scope === "shared" ? null : (
          <Button type="button" size="icon-sm" variant="ghost" aria-label={item.scope === "overrides" ? `Use the value of ${item.name} for all projects` : `Remove ${item.name}`} title={item.scope === "overrides" ? "Use the value for all projects" : undefined} disabled={busy} onClick={() => void save({ remove: [item.name] }, item.scope === "overrides" ? `${item.name} uses the value for all projects` : `Removed ${item.name}`)}>
            {item.scope === "overrides" ? <RotateCcw /> : <Trash2 />}
          </Button>
        )}
      </div>
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ set: { [item.name]: { value, secret: item.secret } } }, `Saved ${item.name}`).then((ok) => ok && setEditing(false));
          }}
        >
          <Input value={value} onChange={(e) => setValue(e.target.value)} type={item.secret ? "password" : "text"} autoComplete="off" placeholder={item.secret ? "New value" : ""} aria-label={`Value of ${item.name}`} required autoFocus />
          <Button type="submit" size="sm" disabled={busy || !value}>
            Save
          </Button>
        </form>
      ) : (
        <p className="truncate font-mono text-xs text-muted-foreground" data-key-hint={item.hint}>{item.secret ? maskedKey(item.hint ?? "set") : item.value}</p>
      )}
    </li>
  );
}

function AddForm(props: { readonly api: EnvApi; readonly onSaved: (view: ProjectEnvView) => void; readonly name?: string }) {
  const [name, setName] = useState(props.name ?? "");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(true);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");
  const { busy, save } = useSave(props.api, props.onSaved);
  const cleanName = name.trim().toUpperCase();
  const valid = ENV_NAME.test(cleanName);
  if (paste) {
    const parsed = parseDotEnv(text);
    const count = Object.keys(parsed).length;
    return (
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const set = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v).map(([k, v]) => [k.toUpperCase(), { value: v, secret }]));
          void save({ set }, `Added ${Object.keys(set).length} variables`).then((ok) => ok && (setText(""), setPaste(false)));
        }}
      >
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={"STRIPE_SECRET_KEY=sk_live_...\nAPI_BASE_URL=https://api.example.com"} className="font-mono text-xs" aria-label="Paste a .env file" autoComplete="off" spellCheck={false} />
        <div className="flex items-center gap-2">
          <KindToggle secret={secret} onChange={setSecret} />
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setPaste(false)}>
            Add one instead
          </button>
          <Button type="submit" size="sm" className="ml-auto" disabled={busy || count === 0}>
            Add {count || ""}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ set: { [cleanName]: { value, secret } } }, `Added ${cleanName}`).then((ok) => ok && (setName(""), setValue("")));
      }}
    >
      <div className="grid grid-cols-[2fr_3fr] gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} placeholder="NAME" aria-label="Name" className="font-mono text-xs" autoComplete="off" spellCheck={false} required />
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" aria-label="Value" type={secret ? "password" : "text"} autoComplete="off" required />
      </div>
      <div className="flex items-center gap-2">
        <KindToggle secret={secret} onChange={setSecret} />
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setPaste(true)}>
          Paste a .env file
        </button>
        <Button type="submit" size="sm" className="ml-auto" disabled={busy || !valid || !value}>
          Add
        </Button>
      </div>
    </form>
  );
}

function NeededKey(props: { readonly name: string; readonly features: readonly string[]; readonly api: EnvApi; readonly onSaved: (view: ProjectEnvView) => void }) {
  const [value, setValue] = useState("");
  const { busy, save } = useSave(props.api, props.onSaved);
  return (
    <form
      className="grid gap-1.5"
      data-env-need={props.name}
      onSubmit={(e) => {
        e.preventDefault();
        void save({ set: { [props.name]: { value, secret: true } } }, `Saved ${props.name}`);
      }}
    >
      <label className="text-xs">
        <span className="font-mono">{props.name}</span>
        {props.features.length ? <span className="text-muted-foreground"> · used by {props.features.join(", ")}</span> : null}
      </label>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} type="password" autoComplete="off" placeholder="Paste the key" aria-label={`Value of ${props.name}`} className="bg-background" required />
        <Button type="submit" size="sm" disabled={busy || !value}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}

export function KeyPrompt(props: { readonly names: readonly string[]; readonly api: EnvApi; readonly onSaved?: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-run/30 bg-run/5 p-4" data-needs-keys>
      <div className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4" />
        {props.names.length === 1 ? "This feature needs a key" : "This feature needs keys"}
      </div>
      <p className="text-sm text-muted-foreground">The code is ready. chef checks it on the preview once these are set, and carries on by itself. Values stay hidden from the agents and are never written to the code.</p>
      {props.names.map((name) => (
        <NeededKey key={name} name={name} features={[]} api={props.api} onSaved={() => props.onSaved?.()} />
      ))}
    </div>
  );
}

export function EnvironmentForm(props: { readonly api: EnvApi }) {
  const [view, setView] = useState<ProjectEnvView | null>(null);
  useEffect(() => {
    props.api.env().then(setView, (e: unknown) => toast.error("Could not load the environment", { description: e instanceof Error ? e.message : String(e) }));
  }, [props.api]);
  if (!view) return <p className="text-xs text-muted-foreground">Loading…</p>;
  return (
    <div className="grid gap-3" data-env>
      {view.needs.length ? (
        <div className="grid gap-2.5 rounded-lg border border-run/30 bg-run/5 p-3">
          <p className="text-xs font-medium">Features are waiting for these</p>
          {view.needs.map((n) => (
            <NeededKey key={n.name} name={n.name} features={n.features} api={props.api} onSaved={setView} />
          ))}
        </div>
      ) : null}
      {view.vars.length ? (
        <ul className="divide-y rounded-lg border px-3">
          {view.vars.map((item) => (
            <VarRow key={`${item.name}:${item.updatedAt}`} item={item} api={props.api} onSaved={setView} />
          ))}
        </ul>
      ) : null}
      <AddForm api={props.api} onSaved={setView} />
    </div>
  );
}
