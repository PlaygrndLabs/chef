import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { missingSettings, SettingsDialog, useSettings } from "@/components/settings-dialog";
import { projectsApi, type GitLinkUpdate } from "@/lib/api";
import { isProjectName } from "@/lib/selection";

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {props.label}
      {props.children}
    </label>
  );
}

function linkFor(url: string, branch: string, token: string): GitLinkUpdate {
  const github = /^https:\/\/github\.com\//.test(url);
  const mode = token ? (github ? "pull-request" : "branch") : "off";
  return { url, branch: branch || "main", mode, syncBranch: "chef", ...(token ? { token } : {}) };
}

export function ProjectForm(props: { readonly onCreated: (name: string) => void; readonly autoFocus?: boolean }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const project = name.trim().toLowerCase();
    if (!isProjectName(project)) {
      toast.error("Use 2 to 31 lower case letters, digits and dashes, starting with a letter");
      return;
    }
    setBusy(true);
    try {
      const repo = url.trim();
      const result = await projectsApi.create({ name: project, ...(repo ? { git: linkFor(repo, branch.trim(), token.trim()) } : {}) });
      toast.success(result.imported ? `Imported ${project} from its repository` : `Created ${project}`);
      props.onCreated(project);
    } catch (e) {
      toast.error("Could not create the project", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      id="new-project"
      className="grid gap-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Project name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" aria-label="Project name" autoComplete="off" autoFocus={props.autoFocus} required />
      </Field>
      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
          Start from an existing repository (optional)
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2.5 grid gap-2.5">
          <Field label="Repository">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/app" aria-label="Repository URL" type="url" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Its main branch">
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Main branch" />
            </Field>
            <Field label="Access token">
              <Input value={token} onChange={(e) => setToken(e.target.value)} aria-label="Access token" type="password" autoComplete="off" placeholder="Needed to send work back" />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">chef works on its own copy and keeps it in sync. Change how later in Project and repository.</p>
        </CollapsibleContent>
      </Collapsible>
      <Button type="submit" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Plus />}
        Create project
      </Button>
    </form>
  );
}

export function AddProjectDialog(props: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onCreated: (name: string) => void }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-dialog="add-project">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>Each project is its own app with its own features and previews.</DialogDescription>
        </DialogHeader>
        <ProjectForm
          autoFocus
          onCreated={(name) => {
            props.onOpenChange(false);
            props.onCreated(name);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function Setup(props: { readonly onCreated: (name: string) => void }) {
  const { settings, setSettings, available } = useSettings();
  const [providers, setProviders] = useState(false);
  const missing = available && missingSettings(settings).length > 0;
  useEffect(() => {
    if (missing) setProviders(true);
  }, [missing]);
  return (
    <div className="flex h-dvh flex-col overflow-y-auto" data-view="setup">
      <div className="flex justify-end p-3">
        {available ? (
          <Button variant="ghost" size="sm" onClick={() => setProviders(true)} className={missing ? "text-bad" : undefined}>
            <KeyRound />
            Settings
          </Button>
        ) : null}
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center gap-3 px-4 pt-10 pb-16 text-center sm:pt-20">
        <span className="grid size-11 place-items-center rounded-xl bg-brand text-lg font-semibold text-brand-foreground">c</span>
        <h1 className="text-2xl font-semibold tracking-tight">Create your first project</h1>
        <p className="text-muted-foreground">Name the app you want chef to build. You can start fresh or bring a repository you already have.</p>
        <div className="mt-4 w-full">
          <ProjectForm autoFocus onCreated={props.onCreated} />
        </div>
      </div>
      {available ? <SettingsDialog open={providers} onOpenChange={setProviders} settings={settings} onChange={setSettings} /> : null}
    </div>
  );
}
