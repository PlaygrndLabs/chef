import { useEffect, useRef } from "react";
import { ProjectSettingsDialog } from "@/components/project-settings-dialog";
import { missingSettings, SettingsDialog } from "@/components/settings-dialog";
import type { SettingsScope } from "@/lib/selection";
import { useWorkspace } from "@/lib/workspace";

export function SettingsHost() {
  const { selection, select, api, data, app, openSettings } = useWorkspace();
  const place = selection.settings ?? null;
  const missing = app.available ? missingSettings(app.settings) : [];
  const asked = useRef(false);
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
      <SettingsDialog open={place?.scope === "app"} onOpenChange={close} settings={app.settings} available={app.available} onChange={app.setSettings} section={place?.scope === "app" ? place.section : "general"} item={selection.item ?? null} nav={nav("app")} returnTo={returnTo} />
      <ProjectSettingsDialog
        open={place?.scope === "project"}
        onOpenChange={close}
        project={selection.project}
        api={api}
        onSaved={data.refresh}
        section={place?.scope === "project" ? place.section : "general"}
        item={selection.item ?? null}
        nav={nav("project")}
        sharedAttempts={app.settings?.attempts.value ?? null}
        onReadCode={() => {
          select({ settings: null, item: null, view: "project", feature: null, session: null, panel: null });
          window.setTimeout(() => window.dispatchEvent(new Event("chef:read-code")), 50);
        }}
      />
    </>
  );
}
