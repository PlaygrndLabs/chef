import { useState } from "react";
import { CloudUpload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appApi, type AppMode } from "@/lib/api";
import { Wordmark } from "@/components/logo";

export const DEPLOY_BUTTON = "https://deploy.workers.cloudflare.com/?url=https://github.com/PlaygrndLabs/chef";

export function ConnectScreen(props: { readonly onConnected: (mode: AppMode) => void }) {
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex h-dvh flex-col overflow-y-auto" data-view="connect">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-3 px-4 pt-10 pb-16 text-center sm:pt-20">
        <Wordmark className="mb-2 h-9" />
        <h1 className="text-2xl font-semibold tracking-tight">Connect chef to your cloud</h1>
        <p className="text-muted-foreground">This app runs on your computer. Sessions, sandboxes and previews run on your chef in Cloudflare, so work goes on when this computer sleeps.</p>
        <form
          className="mt-4 grid w-full gap-2.5 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            appApi.connect(url, password).then(props.onConnected, (err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
              setBusy(false);
            });
          }}
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://chef.your-subdomain.workers.dev" aria-label="Address of your chef" autoComplete="url" autoFocus required />
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Its password" aria-label="Password" type="password" autoComplete="current-password" required />
          {error ? (
            <p className="text-sm text-bad" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Connect
          </Button>
        </form>
        <div className="mt-6 grid w-full gap-2 rounded-lg border p-4 text-left">
          <p className="text-sm font-medium">No chef in the cloud yet?</p>
          <p className="text-xs text-muted-foreground">Deploy one to your Cloudflare account in one click, then paste its address here. Or run pnpm run deploy from this folder.</p>
          <Button asChild variant="outline" size="sm" className="justify-self-start">
            <a href={DEPLOY_BUTTON} target="_blank" rel="noreferrer">
              <CloudUpload />
              Deploy to Cloudflare
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
