import { useEffect, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Group } from "@/components/settings-shell";
import { keysApi, type ApiKeyView } from "@/lib/api";
import { ago } from "@/lib/format";

const LIFETIMES = [
  { label: "No end", days: null },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
] as const;

function describe(key: ApiKeyView, now: number): string {
  const parts = [key.kind === "controller" ? "Full access, can act for people" : "Full access"];
  if (key.source === "deployment") parts.push("from the deployment's CHEF_API_KEY secret");
  else if (key.createdAt) parts.push(`made ${ago(key.createdAt, now)}`);
  parts.push(key.lastUsedAt ? `used ${ago(key.lastUsedAt, now)}` : "never used");
  if (key.expiresAt) parts.push(key.expiresAt > now ? `ends ${new Date(key.expiresAt).toLocaleDateString()}` : "ended");
  return parts.join(" · ");
}

function KeyRow(props: { readonly item: ApiKeyView; readonly onRevoked: () => void }) {
  const { item } = props;
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    if (!confirm(`Revoke ${item.name}? Anything that uses it stops working at once.`)) return;
    setBusy(true);
    try {
      await keysApi.revoke(item.id);
      toast.success(`Revoked ${item.name}`);
      props.onRevoked();
    } catch (e) {
      toast.error("Could not revoke it", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex items-center gap-2 py-2" data-api-key={item.id}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-xs">{item.name}</span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{item.prefix}…</span>
        <span className="truncate text-[11px] text-muted-foreground">{describe(item, Date.now())}</span>
      </div>
      {item.source === "app" ? (
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Revoke ${item.name}`} title="Revoke" disabled={busy} onClick={() => void revoke()}>
          <Trash2 />
        </Button>
      ) : null}
    </li>
  );
}

function NewToken(props: { readonly token: string; readonly onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.token);
      setCopied(true);
    } catch {
      toast.error("Could not copy it");
    }
  };
  return (
    <div className="grid gap-2 border border-dashed p-3" data-new-api-key>
      <p className="text-xs">Copy the key now. Chef keeps only a fingerprint of it and cannot show it again.</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px]">{props.token}</code>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Copy the key" onClick={() => void copy()}>
          {copied ? <Check className="text-ok" /> : <Copy />}
        </Button>
      </div>
      <Button type="button" size="sm" variant="outline" className="w-fit" onClick={props.onDone}>
        Done
      </Button>
    </div>
  );
}

function CreateForm(props: { readonly onCreated: (token: string) => void }) {
  const [name, setName] = useState("");
  const [days, setDays] = useState<number | null>(null);
  const [controller, setController] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      id="settings-api-keys"
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        keysApi
          .create({ name: name.trim(), kind: controller ? "controller" : "key", expiresInDays: days })
          .then(({ token }) => {
            setName("");
            setController(false);
            props.onCreated(token);
          })
          .catch((err: unknown) => toast.error("Could not make the key", { description: err instanceof Error ? err.message : String(err) }))
          .finally(() => setBusy(false));
      }}
    >
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="What uses it, like a deploy script" aria-label="Key name" maxLength={60} autoComplete="off" required />
        <select value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)} aria-label="How long the key lasts" className="h-8 shrink-0 border bg-background px-2 text-xs">
          {LIFETIMES.map((lifetime) => (
            <option key={lifetime.label} value={lifetime.days ?? ""}>
              {lifetime.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={controller} onChange={(e) => setController(e.target.checked)} />
        For an app that manages this Chef and acts for its people
      </label>
      <Button type="submit" size="sm" className="w-fit" disabled={busy || !name.trim()}>
        Make a key
      </Button>
    </form>
  );
}

export function ApiKeysSection() {
  const [keys, setKeys] = useState<readonly ApiKeyView[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const load = () =>
    keysApi
      .list()
      .then(setKeys)
      .catch((e: unknown) => toast.error("Could not load the keys", { description: e instanceof Error ? e.message : String(e) }));
  useEffect(() => void load(), []);
  return (
    <>
      <Group title="Keys" note="Each key opens the whole Chef API. Revoke one and anything that uses it stops at once.">
        {keys === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="divide-y divide-dashed">
            {keys.map((item) => (
              <KeyRow key={item.id} item={item} onRevoked={() => void load()} />
            ))}
          </ul>
        )}
      </Group>
      <Group title="New key" note="Scripts and apps send it as a Bearer token in the Authorization header.">
        {token ? <NewToken token={token} onDone={() => setToken(null)} /> : <CreateForm onCreated={(made) => (setToken(made), void load())} />}
      </Group>
    </>
  );
}
