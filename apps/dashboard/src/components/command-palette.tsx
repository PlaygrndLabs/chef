import { Plus } from "lucide-react";
import { useTheme } from "next-themes";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { FEATURE_LABEL, FEATURE_TONE, StatusDot } from "@/components/status";
import { useWorkspace } from "@/lib/workspace";

export function CommandPalette({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { features, select, openFeature, focusComposer, addProject, projects, selection, openSettings } = useWorkspace();
  const { setTheme, resolvedTheme } = useTheme();
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search chef" description="Jump to a feature or run an action">
      <CommandInput placeholder="Search features and actions" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() =>
              run(() => {
                select({ view: "project", feature: null, session: null, panel: null });
                focusComposer();
              })
            }
          >
            New request
          </CommandItem>
          <CommandItem onSelect={() => run(() => select({ view: "insights", feature: null, session: null, panel: null }))}>Memory and learning</CommandItem>
          <CommandItem onSelect={() => run(() => openSettings("project"))}>Project settings</CommandItem>
          <CommandItem onSelect={() => run(() => openSettings("project", "agents"))}>Agents in this project</CommandItem>
          <CommandItem onSelect={() => run(() => openSettings("project", "environment"))}>Keys and environment of this project</CommandItem>
          <CommandItem onSelect={() => run(() => openSettings("app"))}>Settings for every project</CommandItem>
          <CommandItem onSelect={() => run(() => openSettings("app", "agents"))}>Agents for every project</CommandItem>
          <CommandItem onSelect={() => run(() => openSettings("app", "skills"))}>Skills for every project</CommandItem>
          <CommandItem onSelect={() => run(() => openSettings("app", "router"))}>Router and Jev</CommandItem>
          <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme</CommandItem>
          <CommandItem onSelect={() => run(addProject)}>
            <Plus />
            New project
          </CommandItem>
        </CommandGroup>
        {projects.length > 1 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Projects">
              {projects
                .filter((p) => p !== selection.project)
                .map((p) => (
                  <CommandItem key={p} value={`project ${p}`} onSelect={() => run(() => select({ project: p, view: "project", feature: null, session: null, panel: null }))}>
                    {p}
                  </CommandItem>
                ))}
            </CommandGroup>
          </>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Features">
          {features.map((f) => (
            <CommandItem key={f.id} value={`feature ${f.id} ${f.title}`} onSelect={() => run(() => openFeature(f.id))}>
              <StatusDot tone={FEATURE_TONE[f.status]} />
              {f.title}
              <span className="ml-auto text-xs text-muted-foreground">{FEATURE_LABEL[f.status]}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
