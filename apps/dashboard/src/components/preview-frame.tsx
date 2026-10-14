import { forwardRef, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Step } from "@/components/step";
import { useNow } from "@/lib/live";
import { loadView, previewState, stateLink, type FrameLoad, type LoadView } from "@/lib/preview";
import { cn } from "@/lib/utils";

const POLL_MS = 2000;
const SHOW_AFTER_MS = 350;

const fresh = (): FrameLoad => ({ started: Date.now(), checked: null, building: null, answered: null, loaded: null, error: null });

const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
  });

export type StateFetch = (link: string, retry: boolean, signal: AbortSignal) => Promise<Response | null>;

const fetchState: StateFetch = (link, retry, signal) => fetch(stateLink(link, retry), { cache: "no-store", signal }).catch(() => null);

export function usePreviewLoad(input: { readonly link: string | null; readonly url: string; readonly path: string; readonly count: number; readonly fetch?: StateFetch }) {
  const { link, url, path, count } = input;
  const ask = input.fetch ?? fetchState;
  const [load, setLoad] = useState<FrameLoad>(fresh);
  const [appUrl, setAppUrl] = useState<string | null>(link ? null : url);
  const [enter, setEnter] = useState<string | null>(null);
  const retryNext = useRef(false);
  useEffect(() => {
    setLoad(fresh());
    setAppUrl(link ? null : url);
    setEnter(null);
    if (!link) return;
    const abort = new AbortController();
    const check = async () => {
      let again = retryNext.current;
      retryNext.current = false;
      for (;;) {
        const response = await ask(link, again, abort.signal);
        if (abort.signal.aborted) return;
        again = false;
        const state = previewState(response?.ok || response?.status === 404 ? await response.json().catch(() => null) : null);
        if (abort.signal.aborted) return;
        const at = Date.now();
        if (!state) return setLoad((l) => ({ ...l, error: "chef did not answer. Check your connection and try again." }));
        if (state.status === "ready") {
          setLoad((l) => ({ ...l, checked: l.checked ?? at, building: l.building ? { ...l.building, until: at } : null }));
          setEnter(state.enter ?? null);
          return setAppUrl(state.url);
        }
        if (state.status === "missing") return setLoad((l) => ({ ...l, error: "This feature has no preview yet." }));
        if (state.status === "failed") return setLoad((l) => ({ ...l, checked: l.checked ?? at, building: l.building ?? { since: at, until: null }, error: state.error }));
        setLoad((l) => ({ ...l, checked: l.checked ?? at, building: l.building ?? { since: at - state.elapsedMs, until: null } }));
        await wait(POLL_MS, abort.signal);
        if (abort.signal.aborted) return;
      }
    };
    void check();
    return () => abort.abort();
  }, [link, url, path, count, ask]);
  useEffect(() => {
    if (!appUrl) return;
    const abort = new AbortController();
    const target = `${appUrl.replace(/\/$/, "")}${path}`;
    fetch(target, { method: "HEAD", mode: "no-cors", cache: "no-store", credentials: "omit", signal: abort.signal }).then(
      () => setLoad((l) => (l.answered === null ? { ...l, answered: Date.now() } : l)),
      () => {
        if (!abort.signal.aborted) setLoad((l) => (l.answered === null && l.loaded === null ? { ...l, error: `chef could not reach ${new URL(target).host}. It may be offline or blocked on this network.` } : l));
      },
    );
    return () => abort.abort();
  }, [appUrl, path, count]);
  const loaded = () => setLoad((l) => (l.loaded === null ? { ...l, loaded: Date.now(), error: null } : l));
  return {
    load,
    ready: appUrl !== null,
    appUrl,
    enter,
    loaded,
    retryNext: () => {
      retryNext.current = true;
    },
  };
}

export function loadTone(load: FrameLoad): "run" | "ok" | "bad" {
  return load.loaded !== null ? "ok" : load.error ? "bad" : "run";
}

export const PreviewFrame = forwardRef<HTMLIFrameElement, { readonly src: string | null; readonly title: string; readonly load: FrameLoad; readonly preview: boolean; readonly path: string; readonly onLoad: () => void; readonly onRetry: () => void }>(function PreviewFrame(props, ref) {
  const { load } = props;
  const busy = load.loaded === null;
  const now = useNow(busy ? 200 : 60_000);
  const view = loadView(load, busy ? now : (load.loaded ?? now), { preview: props.preview, path: props.path });
  const shown = busy && (now - load.started >= SHOW_AFTER_MS || load.building !== null || load.error !== null);
  return (
    <div className="relative flex min-h-[320px] w-full flex-1 flex-col">
      {props.src ? <iframe ref={ref} src={props.src} title={props.title} onLoad={props.onLoad} className="w-full flex-1 rounded-xl border bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" /> : <div className="flex-1 rounded-xl border" />}
      {shown ? <LoadPanel view={view} onRetry={props.onRetry} /> : null}
    </div>
  );
});

function LoadPanel({ view, onRetry }: { readonly view: LoadView; readonly onRetry: () => void }) {
  const failed = view.phase === "failed";
  return (
    <div className="absolute inset-0 grid place-items-center overflow-auto rounded-xl border bg-background p-6" data-preview-load={view.phase} role="status" aria-live="polite">
      <div className="grid w-full max-w-sm gap-4">
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="kicker">{failed ? "Stopped" : "Loading"}</h3>
            {failed ? null : <span className="font-mono text-xs text-muted-foreground tabular-nums">{view.percent}%</span>}
          </div>
          <Progress value={failed ? 100 : view.percent} className={cn(failed && "[&>[data-slot=progress-indicator]]:bg-bad")} aria-label={view.title} />
        </div>
        <div className="grid gap-1">
          <p className="text-sm font-medium">{view.title}</p>
          <p className={cn("text-xs text-muted-foreground", failed && "break-words whitespace-pre-wrap text-bad")}>{view.detail}</p>
        </div>
        <ol className="grid gap-2">
          {view.steps.map((step) => (
            <Step key={step.label} state={step.state} took={step.took === null ? null : seconds(step.took)}>
              {step.label}
            </Step>
          ))}
        </ol>
        {failed || view.slow ? (
          <div>
            <Button type="button" size="sm" variant={failed ? "default" : "outline"} onClick={onRetry}>
              {failed ? "Try again" : "Reload"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
