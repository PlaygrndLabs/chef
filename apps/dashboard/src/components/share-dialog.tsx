import { useEffect, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
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
  session: { label: "This build", note: "Its preview, the code it changed and its commits." },
  preview: { label: "Only the preview", note: "The running app, nothing about how it was built." },
};

export interface ShareTarget {
  readonly project: string;
  readonly title: string;
  readonly session: string;
  readonly preview: string | null;
}

function describe(share: ShareView, now: number): string {
  const parts = [WHAT[share.kind].label, `made ${ago(share.createdAt, now)}`, share.lastUsedAt ? `opened ${ago(share.lastUsedAt, now)}` : "not opened yet"];
  if (share.expiresAt) parts.push(share.expiresAt > now ? `ends ${new Date(share.expiresAt).toLocaleDateString()}` : "ended");
  return parts.join(" · ");
}

function CopyLink({ link }: { readonly link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast.error("Could not copy it");
    }
  };
  return (
    <div className="grid gap-2 border border-dashed p-3" data-new-share>
      <p className="text-xs">Copy the link now. Chef keeps only a fingerprint of it and cannot show it again.</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-[11px]">{link}</code>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Copy the link" onClick={() => void copy()}>
          {copied ? <Check className="text-ok" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

export function ShareDialog(props: { readonly target: ShareTarget; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { target } = props;
  const api = sharesApi(target.project);
  const [kind, setKind] = useState<ShareKind>("session");
  const [days, setDays] = useState<number | null>(30);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [shares, setShares] = useState<readonly ShareView[] | null>(null);
  const mine = (shares ?? []).filter((s) => (s.kind === "session" && s.id === target.session) || (s.kind === "preview" && s.id === target.preview));
  const load = () =>
    api
      .list()
      .then(setShares)
      .catch((e: unknown) => toast.error("Could not load the links", { description: e instanceof Error ? e.message : String(e) }));
  useEffect(() => {
    if (!props.open) return;
    setLink(null);
    void load();
  }, [props.open, target.project]);
  const make = async () => {
    const id = kind === "session" ? target.session : target.preview;
    if (!id) return;
    setBusy(true);
    try {
      const { token } = await api.create({ kind, id, expiresInDays: days });
      setLink(shareLink(location.origin, token));
      void load();
    } catch (e) {
      toast.error("Could not make the link", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (share: ShareView) => {
    if (!confirm("End this link? It stops opening anything at once; a preview someone already has open closes within an hour.")) return;
    try {
      await api.revoke(share.shareId);
      toast.success("Link ended");
      void load();
    } catch (e) {
      toast.error("Could not end the link", { description: e instanceof Error ? e.message : String(e) });
    }
  };
  const endAll = async () => {
    if (!confirm("Close every open preview of this project? Everyone who has one open, from Chef or from a shared link, has to open it again. Do this after ending a link to shut it out at once.")) return;
    try {
      await api.endPreviewLinks();
      toast.success("Every open preview was closed");
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
            {(["session", "preview"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                disabled={k === "preview" && !target.preview}
                onClick={() => setKind(k)}
                className={cn("grid gap-0.5 border px-3 py-2 text-left hover:bg-muted disabled:opacity-50", kind === k && "border-primary")}
              >
                <span className="text-sm">{WHAT[k].label}</span>
                <span className="text-xs text-muted-foreground">{WHAT[k].note}</span>
              </button>
            ))}
          </div>
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
          {link ? <CopyLink link={link} /> : null}
          {mine.length ? (
            <div className="grid gap-1">
              <h3 className="kicker">Links to this build</h3>
              <ul className="divide-y divide-dashed">
                {mine.map((share) => (
                  <li key={share.shareId} className="flex items-center gap-2 py-2" data-share={share.shareId}>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{describe(share, Date.now())}</span>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="End this link" title="End this link" onClick={() => void revoke(share)}>
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <button type="button" onClick={() => void endAll()} className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Close every open preview of this project
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
