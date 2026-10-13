import { Suspense, useEffect, useRef } from "react";
import { preloadable, useOpenedOnce } from "@/lib/lazy";
import { missingSettings } from "@/lib/settings";
import type { SettingsScope } from "@/lib/selection";
import { useWorkspace } from "@/lib/workspace";

const SettingsDialog = preloadable(() => import("@/components/settings-dialog").then((m) => m.SettingsDialog));
const ProjectSettingsDialog = preloadable(() => import("@/components/project-settings-dialog").then((m) => m.ProjectSettingsDialog));

export function preloadSettings() {
  void SettingsDialog.preload();
  void ProjectSettingsDialog.preload();
}

export function SettingsHost() {
  const { selection, select, api, data, app, openSettings } = useWorkspace();
  const place = selection.settings ?? null;
  const missing = app.available ? missingSettings(app.settings) : [];
  const asked = useRef(false);
  const appOpen = place?.scope === "app";
  const projectOpen = place?.scope === "project";
  const appLoaded = useOpenedOnce(appOpen);
  const projectLoaded = useOpenedOnce(projectOpen);
  useEffect(() => {
    if (asked.current || missing.length === 0) return;
    asked.current = true;
    if (!place) openSettings("app", missing[0]);
  }, [missing.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings("app");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings]);
  const close = (open: boolean) => {
    if (!open) select({ settings: null, item: null });
  };
  const nav = (scope: SettingsScope) => ({
    go: (section: string, item: string | null, to?: SettingsScope) => openSettings(to ?? scope, section, item),
    section: (section: string) => openSettings(scope, section),
  });
  const returnTo = `/?project=${selection.project}&settings=app.github`;
  return (
    <>
      {appLoaded ? (
        <Suspense fallback={null}>
          <SettingsDialog open={appOpen} onOpenChange={close} settings={app.settings} available={app.available} onChange={app.setSettings} section={appOpen ? place.section : "general"} item={selection.item ?? null} nav={nav("app")} returnTo={returnTo} />
        </Suspense>
      ) : null}
      {projectLoaded ? (
        <Suspense fallback={null}>
          <ProjectSettingsDialog
            open={projectOpen}
            onOpenChange={close}
            project={selection.project}
            api={api}
            onSaved={data.refresh}
            section={projectOpen ? place.section : "general"}
            item={selection.item ?? null}
            nav={nav("project")}
            sharedAttempts={app.settings?.attempts.value ?? null}
            onReadCode={() => {
              select({ settings: null, item: null });
              window.setTimeout(() => window.dispatchEvent(new Event("chef:read-code")), 50);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
