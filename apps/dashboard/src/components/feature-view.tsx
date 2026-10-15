import { useState } from "react";
import { Hammer, MessageSquareText, Pencil } from "lucide-react";
import { toast } from "sonner";
import { stepsTo } from "@chef/core/features";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MapMarkIcon, MARK_LABEL } from "@/components/map-mark";
import type { FeatureNode } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace";

function PathEditor({ feature, onDone }: { readonly feature: FeatureNode; readonly onDone: () => void }) {
  const { api, data } = useWorkspace();
  const [text, setText] = useState(feature.map?.path ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!feature.map) return;
    setBusy(true);
    try {
      await api.editMap({ kind: "update", id: feature.map.id, path: text });
      data.refresh();
      onDone();
    } catch (error) {
      toast.error("Could not save the path", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <Textarea autoFocus aria-label="Steps from the feature above" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function FeatureView({ feature }: { readonly feature: FeatureNode }) {
  const { api, data, openSession, focusComposer } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);
  const map = data.spec?.map ?? null;
  const route = map && feature.map ? stepsTo(map, feature.map.id) : null;
  const build = async () => {
    setStarting(true);
    try {
      const result = await api.prompt(`#${feature.id} Build ${feature.title}`);
      data.refresh();
      if (result.sessionId) openSession(result.sessionId);
    } catch (error) {
      toast.error(`Could not start "${feature.title}"`, { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-view="feature" data-feature={feature.id} data-mark={feature.mark}>
      <header className="flex h-12 shrink-0 items-center gap-2.5 px-4">
        <h1 className="min-w-0 truncate text-base font-medium">{feature.title}</h1>
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 bg-muted px-2.5 text-xs font-medium text-muted-foreground">
          <MapMarkIcon mark={feature.mark} className="size-3" />
          {MARK_LABEL[feature.mark]}
        </span>
        <span className="flex-1" />
        {feature.mark === "wish" ? (
          <Button size="sm" onClick={() => void build()} disabled={starting} data-action="build">
            <Hammer />
            {starting ? "Starting" : "Build it"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={focusComposer}>
            <MessageSquareText />
            Ask for a change
          </Button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 dash-t">
        <section className="grid max-w-2xl gap-3 pt-4 text-sm" data-section="path">
          <h2 className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">How to reach it</h2>
          {route ? (
            <ol className="grid gap-3">
              <li className="grid gap-0.5">
                <span className="text-xs text-muted-foreground">Start the project</span>
                <span className="whitespace-pre-wrap">{route.start || "Not written yet."}</span>
              </li>
              {route.steps.map((step, i) => {
                const own = i === route.steps.length - 1;
                return (
                  <li key={step.id} className="grid gap-0.5" data-step={step.id}>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {own ? "Then, for this feature" : `Then, to reach ${step.title}`}
                      {own && !editing ? (
                        <button type="button" onClick={() => setEditing(true)} aria-label="Edit the steps" className="text-muted-foreground hover:text-foreground">
                          <Pencil className="size-3" />
                        </button>
                      ) : null}
                    </span>
                    {own && editing ? <PathEditor feature={feature} onDone={() => setEditing(false)} /> : <span className="whitespace-pre-wrap">{step.path || "Not written yet."}</span>}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-muted-foreground">This feature is not in the feature map yet.</p>
          )}
        </section>
        {feature.map?.specs ? (
          <section className="grid max-w-2xl gap-2 pt-6 text-sm" data-section="specs">
            <h2 className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Specs</h2>
            <p className="whitespace-pre-wrap">{feature.map.specs}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
