import { useEffect, useState, type ReactNode } from "react";
import { Cloud, CloudUpload, Loader2, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { appApi, type AppMode, type CloudflareCheck } from "@/lib/api";
import { Wordmark } from "@/components/logo";

export const DEPLOY_BUTTON = "https://deploy.workers.cloudflare.com/?url=https://github.com/PlaygrndLabs/chef";
const TOKENS = "https://dash.cloudflare.com/profile/api-tokens";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(task: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await task();
    } catch (err) {
      setError(message(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Problem(props: { readonly text: string | null }) {
  return props.text ? (
    <p className="text-sm text-bad" role="alert">
      {props.text}
    </p>
  ) : null;
}

function Log(props: { readonly lines: readonly string[] }) {
  return props.lines.length ? <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-left text-[11px] leading-relaxed whitespace-pre-wrap">{props.lines.join("\n")}</pre> : null;
}

function Card(props: { readonly icon: ReactNode; readonly title: string; readonly badge?: string; readonly note: string; readonly place: string; readonly children: ReactNode }) {
  return (
    <section className="grid content-start gap-3 rounded-xl border p-4 text-left" data-place={props.place}>
      <div className="flex items-center gap-2">
        {props.icon}
        <h2 className="font-medium">{props.title}</h2>
        {props.badge ? <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">{props.badge}</span> : null}
      </div>
      <p className="text-sm text-muted-foreground">{props.note}</p>
      {props.children}
    </section>
  );
}

function ConnectForm(props: { readonly onDone: (mode: AppMode) => void; readonly url?: string; readonly label?: string }) {
  const [url, setUrl] = useState(props.url ?? "");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="grid gap-2.5"
      data-view="connect"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => appApi.connect(url, password)).then((mode) => mode && props.onDone(mode));
      }}
    >
      {props.url ? null : <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://chef.your-subdomain.workers.dev" aria-label="Address of your chef" autoComplete="url" required />}
      <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Its password" aria-label="Password" type="password" autoComplete="current-password" required />
      <Problem text={error} />
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        {props.label ?? "Connect"}
      </Button>
    </form>
  );
}

function SetupForm(props: { readonly mode: AppMode; readonly onDone: (mode: AppMode) => void; readonly onChange: (mode: AppMode) => void }) {
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [password, setPassword] = useState("");
  const [found, setFound] = useState<CloudflareCheck | null>(null);
  const check = useAction();
  const deploy = useAction();
  const setup = props.mode.setup;
  const running = setup?.status === "running";
  return (
    <div className="grid gap-2.5" data-view="cloudflare-setup">
      <ol className="grid list-decimal gap-1 pl-4 text-xs text-muted-foreground">
        <li>
          In Cloudflare,{" "}
          <a className="underline" href={TOKENS} target="_blank" rel="noreferrer">
            create an API token
          </a>{" "}
          from the Edit Cloudflare Workers template, and add edit access to Containers, Vectorize, Workflows and Artifacts.
        </li>
        <li>Copy your account id from the Workers page in the Cloudflare dashboard.</li>
        <li>chef checks the account, and sets itself up there if it is not there yet.</li>
      </ol>
      <form
        className="grid gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void check.run(() => appApi.checkCloudflare(accountId, apiToken)).then(setFound);
        }}
      >
        <Input value={accountId} onChange={(e) => (setAccountId(e.target.value), setFound(null))} placeholder="Account id" aria-label="Cloudflare account id" autoComplete="off" required />
        <Input value={apiToken} onChange={(e) => (setApiToken(e.target.value), setFound(null))} placeholder="API token" aria-label="Cloudflare API token" type="password" autoComplete="off" required />
        <Problem text={check.error} />
        {found ? null : (
          <Button type="submit" variant="outline" disabled={check.busy}>
            {check.busy ? <Loader2 className="animate-spin" /> : null}
            Check my account
          </Button>
        )}
      </form>
      {found?.deployed && found.url ? (
        <div className="grid gap-2" data-found="deployed">
          <p className="text-xs">chef is already set up on this account at {found.url}. Enter its password to connect.</p>
          <ConnectForm url={found.url} onDone={props.onDone} />
        </div>
      ) : null}
      {found && !found.deployed ? (
        <form
          className="grid gap-2"
          data-found="missing"
          onSubmit={(e) => {
            e.preventDefault();
            void deploy.run(() => appApi.deployCloudflare(accountId, apiToken, password)).then((mode) => mode && props.onChange(mode));
          }}
        >
          <p className="text-xs">chef is not on this account yet. Pick the password you will sign in with, and chef sets itself up there. It takes a few minutes and needs Docker on this computer.</p>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password, at least 8 characters" aria-label="Password for your chef in Cloudflare" type="password" autoComplete="new-password" minLength={8} required disabled={running} />
          <Problem text={deploy.error ?? (setup?.status === "failed" ? setup.error : null)} />
          <Button type="submit" disabled={deploy.busy || running}>
            {running ? <Loader2 className="animate-spin" /> : <CloudUpload />}
            {running ? "Setting up chef on Cloudflare" : "Set up chef on Cloudflare"}
          </Button>
          {setup && setup.status !== "idle" ? <Log lines={setup.log} /> : null}
        </form>
      ) : null}
      <p className="text-xs text-muted-foreground">
        No Docker here? Deploy with the{" "}
        <a className="underline" href={DEPLOY_BUTTON} target="_blank" rel="noreferrer">
          Deploy to Cloudflare
        </a>{" "}
        button instead, then connect to it.
      </p>
    </div>
  );
}

function Starting(props: { readonly mode: AppMode; readonly onChange: (mode: AppMode) => void }) {
  const computer = props.mode.computer;
  const { busy, error, run } = useAction();
  const failed = computer?.status === "failed";
  return (
    <div className="mx-auto grid w-full max-w-lg gap-3 px-4 pt-16 text-center" data-view="starting">
      <h1 className="text-xl font-semibold">{failed ? "chef could not start on this computer" : "Starting chef on this computer"}</h1>
      <p className="text-sm text-muted-foreground">{failed ? computer?.error : "The first start builds the sandbox image, which takes a few minutes."}</p>
      {failed ? null : <Loader2 className="mx-auto animate-spin text-muted-foreground" />}
      <Log lines={computer?.log ?? []} />
      <Problem text={error} />
      <div className="flex justify-center gap-2">
        {failed ? (
          <Button disabled={busy} onClick={() => void run(() => appApi.useComputer()).then((mode) => mode && props.onChange(mode))}>
            Try again
          </Button>
        ) : null}
        {props.mode.fixed ? null : (
          <Button variant="outline" disabled={busy} onClick={() => void run(() => appApi.disconnect()).then((mode) => mode && props.onChange(mode))}>
            Choose again
          </Button>
        )}
      </div>
    </div>
  );
}

export function PlaceScreen(props: { readonly mode: AppMode; readonly onChange: (mode: AppMode) => void }) {
  const { mode, onChange } = props;
  const computer = useAction();
  const waiting = mode.place === "computer" || mode.setup?.status === "running";
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void appApi.get().then(onChange), 1500);
    return () => window.clearInterval(timer);
  }, [waiting, onChange]);
  if (mode.place === "computer") return <Starting mode={mode} onChange={onChange} />;
  return (
    <div className="flex h-dvh flex-col overflow-y-auto" data-view="place">
      <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 pt-10 pb-16 sm:pt-16">
        <div className="grid justify-items-center gap-2 text-center">
          <Wordmark className="mb-2 h-11" />
          <h1 className="text-2xl font-semibold tracking-tight">Where should chef work?</h1>
          <p className="max-w-xl text-muted-foreground">This app runs on your computer either way. Pick where the agents, sandboxes and previews run. You can change it later in Settings.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card place="cloud" icon={<Cloud className="size-5 text-brand" />} title="On Cloudflare" badge="Recommended" note="The work runs in your Cloudflare account and this app is only the window. It stays light on this computer, and work goes on while it sleeps. Needs a Cloudflare account on the Workers Paid plan.">
            <Tabs defaultValue="connect">
              <TabsList className="w-full">
                <TabsTrigger value="connect" className="text-xs">
                  I have chef there
                </TabsTrigger>
                <TabsTrigger value="setup" className="text-xs">
                  Set it up
                </TabsTrigger>
              </TabsList>
              <TabsContent value="connect" className="pt-2">
                <ConnectForm onDone={onChange} />
              </TabsContent>
              <TabsContent value="setup" className="pt-2">
                <SetupForm mode={mode} onDone={onChange} onChange={onChange} />
              </TabsContent>
            </Tabs>
          </Card>
          <Card place="computer" icon={<Monitor className="size-5 text-brand" />} title="On this computer" note="Everything runs here in Docker: projects, agents, sandboxes and previews. No cloud account needed. It uses this computer's CPU, memory and a few GB of disk, and work pauses while it sleeps.">
            {mode.docker ? <p className="text-xs text-muted-foreground" data-docker="missing">{mode.docker}</p> : null}
            <Problem text={computer.error} />
            <Button variant="outline" disabled={computer.busy || Boolean(mode.docker)} onClick={() => void computer.run(() => appApi.useComputer()).then((next) => next && onChange(next))}>
              {computer.busy ? <Loader2 className="animate-spin" /> : null}
              Use this computer
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
