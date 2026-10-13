import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { githubApi, type GitHubView, type InstalledRepository } from "@/lib/api";
import { cn } from "@/lib/utils";

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {props.label}
      {props.children}
    </label>
  );
}

export function GitHubPicker(props: { readonly returnTo: string; readonly github: GitHubView | null; readonly selected: string; readonly onPick: (repo: InstalledRepository) => void; readonly onForget: () => void }) {
  const { github } = props;
  const [query, setQuery] = useState("");
  const [organization, setOrganization] = useState("");
  const { returnTo } = props;
  if (!github) return <p className="text-xs text-muted-foreground">Checking GitHub…</p>;
  if (!github.app)
    return (
      <div className="grid gap-2.5 rounded-lg border p-3" data-github="none">
        <p className="text-xs text-muted-foreground">chef sends you to GitHub, where you pick the repositories it may use, then brings you back here. The first time, GitHub also asks you to create chef&apos;s own app for this deployment.</p>
        <Field label="GitHub organization that owns the repositories (leave empty for your own account)">
          <Input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="your-org" aria-label="GitHub organization" autoComplete="off" />
        </Field>
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => location.assign(githubApi.connectUrl(returnTo, organization.trim() || undefined))}>
            Connect GitHub
          </Button>
        </div>
      </div>
    );
  const shown = github.repositories.filter((r) => r.fullName.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="grid gap-2" data-github="connected">
      {github.repositories.length > 6 ? <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" /> : null}
      <div role="radiogroup" aria-label="GitHub repository" className="grid max-h-48 gap-px overflow-y-auto rounded-lg border p-1">
        {shown.map((r) => (
          <button key={r.fullName} type="button" role="radio" aria-checked={props.selected === r.url} onClick={() => props.onPick(r)} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs", props.selected === r.url ? "bg-muted font-medium" : "hover:bg-muted/60")}>
            <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
            {r.private ? <Lock className="size-3 text-muted-foreground" aria-label="Private" /> : null}
          </button>
        ))}
        {shown.length === 0 ? <p className="px-2 py-1.5 text-xs text-muted-foreground">{github.error ?? (github.repositories.length === 0 ? "chef cannot see any repositories yet." : "No repository matches.")}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Missing one?{" "}
        <button type="button" className="underline" onClick={() => location.assign(githubApi.connectUrl(returnTo))}>
          Add repositories on GitHub
        </button>
        {" · "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            if (confirm(`Forget ${github.app?.name ?? "chef's GitHub app"}? Projects linked through it stop syncing until you connect GitHub again. Delete the app in GitHub's developer settings too.`)) props.onForget();
          }}
        >
          Use another GitHub account
        </button>
      </p>
    </div>
  );
}
