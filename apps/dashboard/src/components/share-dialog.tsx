import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shareLink, sharesApi, type ShareKind, type ShareView } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

const LIFETIMES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "No end", days: null },
] as const;

const WHAT: Readonly<Record<ShareKind, { readonly label: string; readonly note: string }>> = {
  session: { label: "This build", note: "Its running app, the code it changed and its commits." },
  app: { label: "Only the app", note: "The running app, nothing about how it was built." },
};

export interface ShareTarget {
  readonly project: string;
  readonly title: string;
  readonly session: string;
}

function describe(share: ShareView, now: number): string {
  const parts = [`made ${ago(share.createdAt, now)}`, share.lastUsedAt ? `opened ${ago(share.lastUsedAt, now)}` : "not opened yet"];
  parts.push(share.expiresAt ? `ends ${new Date(share.expiresAt).toLocaleDateString()}` : "no end");
  return parts.join(" · ");
}

function CopyLink({ link }: { readonly link: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast.error("Could not copy it");
    }
  };
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px]">{link}</code>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Copy the link" onClick={() => void copy()}>
        {copied ? <Check className="text-ok" /> : <Copy />}
      </Button>
    </div>
  );
}

export function ShareDialog(props: { readonly target: ShareTarget; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { target } = props;
  const api = sharesApi(target.project);
  const [kind, setKind] = useState<ShareKind>("session");
  const [days, setDays] = useState<number | null>(30);
  const [busy, setBusy] = useState(false);
  const [shares, setShares] = useState<readonly ShareView[] | null>(null);
  const mine = (shares ?? []).filter((s) => s.id === target.session);
  const current = mine.find((s) => s.kind === kind) ?? null;
  const load = () =>
    api
      .list()
      .then(setShares)
      .catch((e: unknown) => toast.error("Could not load the link", { description: e instanceof Error ? e.message : String(e) }));
  useEffect(() => {
    if (!props.open) return;
    void load();
  }, [props.open, target.project]);
  const make = async () => {
    setBusy(true);
    try {
      await api.create({ kind, id: target.session, expiresInDays: days });
      await load();
    } catch (e) {
      toast.error("Could not make the link", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async (share: ShareView) => {
    if (!confirm("Turn off this link? It stops opening anything at once; an app someone already has open closes within an hour.")) return;
    setBusy(true);
    try {
      await api.revoke(share.shareId);
      toast.success("Link turned off");
      await load();
    } catch (e) {
      toast.error("Could not turn off the link", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const endAll = async () => {
    if (!confirm("Close every open app of this project? Everyone who has one open, from Chef or from a shared link, has to open it again. Do this after ending a link to shut it out at once.")) return;
    try {
      await api.closeOpenApps();
      toast.success("Every open app was closed");
    } catch (e) {
      toast.error("Could not end them", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-dialog="share">
        <DialogHeader>
          <DialogTitle>Share {target.title}</DialogTitle>
          <DialogDescription>Anyone with the link can look. Nobody can change anything through it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2" role="radiogroup" aria-label="What to share">
            {(["session", "app"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn("grid gap-0.5 border px-3 py-2 text-left hover:bg-muted disabled:opacity-50", kind === k && "border-primary")}
              >
                <span className="text-sm">{WHAT[k].label}</span>
                <span className="text-xs text-muted-foreground">
                  {WHAT[k].note}
                  {mine.some((s) => s.kind === k) ? " Has a link." : ""}
                </span>
              </button>
            ))}
          </div>
          {current ? (
            <div className="grid gap-2 border border-dashed p-3" data-share={current.shareId}>
              <CopyLink link={shareLink(location.origin, current.token)} />
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{describe(current, Date.now())}</span>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void turnOff(current)}>
                  Turn off
                </Button>
              </div>
            </div>
          ) : shares ? (
            <div className="flex items-center gap-2">
              <select value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)} aria-label="How long the link works" className="h-8 border bg-background px-2 text-xs">
                {LIFETIMES.map((lifetime) => (
                  <option key={lifetime.label} value={lifetime.days ?? ""}>
                    {lifetime.label}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" disabled={busy} onClick={() => void make()}>
                Make a link
              </Button>
            </div>
          ) : null}
          <button type="button" onClick={() => void endAll()} className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Close every open app of this project
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
