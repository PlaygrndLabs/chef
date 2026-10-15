import { forwardRef, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Step } from "@/components/step";
import { useNow } from "@/lib/live";
import { appState, loadView, stateLink, type FrameLoad, type LoadView } from "@/lib/app-view";
import { cn } from "@/lib/utils";

const POLL_MS = 2000;
const SHOW_AFTER_MS = 350;

const fresh = (): FrameLoad => ({ started: Date.now(), checked: null, starting: null, answered: null, loaded: null, error: null });

const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
  });

export type StateFetch = (link: string, retry: boolean, signal: AbortSignal) => Promise<Response | null>;

const fetchState: StateFetch = (link, retry, signal) => fetch(stateLink(link, retry), { cache: "no-store", signal }).catch(() => null);

export function useAppLoad(input: { readonly link: string; readonly path: string; readonly count: number; readonly missing?: string; readonly fetch?: StateFetch }) {
  const { link, path, count } = input;
  const missing = input.missing ?? "There is no app here yet. It starts after the first commit.";
  const ask = input.fetch ?? fetchState;
  const [load, setLoad] = useState<FrameLoad>(fresh);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [enter, setEnter] = useState<string | null>(null);
  const retryNext = useRef(false);
  useEffect(() => {
    setLoad(fresh());
    setAppUrl(null);
    setEnter(null);
    const abort = new AbortController();
    const check = async () => {
      let again = retryNext.current;
      retryNext.current = false;
      for (;;) {
        const response = await ask(link, again, abort.signal);
        if (abort.signal.aborted) return;
        again = false;
        const state = appState(response?.ok || response?.status === 404 ? await response.json().catch(() => null) : null);
        if (abort.signal.aborted) return;
        const at = Date.now();
        if (!state) return setLoad((l) => ({ ...l, error: "Chef did not answer. Check your connection and try again." }));
        if (state.status === "ready") {
          setLoad((l) => ({ ...l, checked: l.checked ?? at, starting: l.starting ? { ...l.starting, until: at } : null }));
          setEnter(state.enter ?? null);
          return setAppUrl(state.url);
        }
        if (state.status === "missing") return setLoad((l) => ({ ...l, error: missing }));
        if (state.status === "no-stack") return setLoad((l) => ({ ...l, checked: l.checked ?? at, noStack: true }));
        if (state.status === "failed") return setLoad((l) => ({ ...l, checked: l.checked ?? at, starting: l.starting ?? { since: at, until: null }, error: state.error }));
        setLoad((l) => ({ ...l, checked: l.checked ?? at, starting: l.starting ?? { since: at - state.elapsedMs, until: null } }));
        await wait(POLL_MS, abort.signal);
        if (abort.signal.aborted) return;
      }
    };
    void check();
    return () => abort.abort();
  }, [link, path, count, ask, missing]);
  useEffect(() => {
    if (!appUrl) return;
    const abort = new AbortController();
    const target = `${appUrl.replace(/\/$/, "")}${path}`;
    fetch(target, { method: "HEAD", mode: "no-cors", cache: "no-store", credentials: "omit", signal: abort.signal }).then(
      () => setLoad((l) => (l.answered === null ? { ...l, answered: Date.now() } : l)),
      () => {
        if (!abort.signal.aborted) setLoad((l) => (l.answered === null && l.loaded === null ? { ...l, error: `Chef could not reach ${new URL(target).host}. It may be offline or blocked on this network.` } : l));
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
  return load.loaded !== null ? "ok" : load.error || load.noStack ? "bad" : "run";
}

export interface AddCompose {
  readonly asked: boolean;
  readonly onAsk: () => void;
}

export const AppFrame = forwardRef<HTMLIFrameElement, { readonly src: string | null; readonly title: string; readonly load: FrameLoad; readonly path: string; readonly onLoad: () => void; readonly onRetry: () => void; readonly addCompose?: AddCompose | undefined }>(function AppFrame(props, ref) {
  const { load } = props;
  const busy = load.loaded === null;
  const now = useNow(busy ? 200 : 60_000);
  const view = loadView(load, busy ? now : (load.loaded ?? now), { path: props.path });
  const shown = busy && (now - load.started >= SHOW_AFTER_MS || load.starting !== null || load.error !== null || load.noStack === true);
  return (
    <div className="relative flex min-h-[320px] w-full flex-1 flex-col">
      {props.src ? <iframe ref={ref} src={props.src} title={props.title} onLoad={props.onLoad} className="w-full flex-1 rounded-xl border bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" /> : <div className="flex-1 rounded-xl border" />}
      {shown ? <LoadPanel view={view} onRetry={props.onRetry} addCompose={props.addCompose} /> : null}
    </div>
  );
});

function LoadPanel({ view, onRetry, addCompose }: { readonly view: LoadView; readonly onRetry: () => void; readonly addCompose: AddCompose | undefined }) {
  const failed = view.phase === "failed" || view.phase === "no-stack";
  return (
    <div className="absolute inset-0 grid place-items-center overflow-auto rounded-xl border bg-background p-6" data-app-load={view.phase} role="status" aria-live="polite">
      <div className="grid w-full max-w-sm gap-4">
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="kicker">{view.phase === "no-stack" ? "No app" : failed ? "Stopped" : "Loading"}</h3>
            {failed ? null : <span className="font-mono text-xs text-muted-foreground tabular-nums">{view.percent}%</span>}
          </div>
          <Progress value={failed ? 100 : view.percent} className={cn(failed && "[&>[data-slot=progress-indicator]]:bg-bad")} aria-label={view.title} />
        </div>
        <div className="grid gap-1">
          <p className="text-sm font-medium">{view.title}</p>
          <p className={cn("text-xs text-muted-foreground", view.phase === "failed" && "break-words whitespace-pre-wrap text-bad")}>{view.detail}</p>
        </div>
        <ol className="grid gap-2">
          {view.steps.map((step) => (
            <Step key={step.label} state={step.state} took={step.took === null ? null : seconds(step.took)}>
              {step.label}
            </Step>
          ))}
        </ol>
        {view.phase === "no-stack" && addCompose ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={addCompose.asked} onClick={addCompose.onAsk} data-add-compose>
              {addCompose.asked ? "Chef is dockerizing it" : "Dockerize the project"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
              Check again
            </Button>
          </div>
        ) : failed || view.slow ? (
          <div>
            <Button type="button" size="sm" variant={failed ? "default" : "outline"} onClick={onRetry}>
              {view.phase === "no-stack" ? "Check again" : failed ? "Try again" : "Reload"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
