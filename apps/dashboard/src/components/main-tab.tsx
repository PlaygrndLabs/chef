import { useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistoryView } from "@/components/history-view";
import { MainApp } from "@/components/session-sections";
import { ToneBadge } from "@/components/status";
import { APP_STATUS_LABEL, APP_TONE, short } from "@/lib/format";
import { useWorkspace } from "@/lib/workspace";

type Section = "app" | "history";

function remembered(project: string): Section {
  try {
    return localStorage.getItem(`chef:main:${project}`) === "history" ? "history" : "app";
  } catch {
    return "app";
  }
}

function remember(project: string, section: Section) {
  try {
    localStorage.setItem(`chef:main:${project}`, section);
  } catch {
    return;
  }
}

export function MainTab() {
  const { data, selection, panelExpanded, expandPanel } = useWorkspace();
  const [section, setSection] = useState<Section>(() => remembered(selection.project));
  const show = (next: Section) => {
    setSection(next);
    remember(selection.project, next);
  };
  const app = data.spec?.mainApp ?? null;
  return (
    <Tabs value={section} onValueChange={(v) => show(v as Section)} className="flex h-full min-h-0 flex-col gap-0 bg-background" data-view="main" data-section={section}>
      <header className="flex h-12 shrink-0 items-center gap-2.5 px-4">
        <h1 className="min-w-0 truncate text-base font-medium">{selection.project}</h1>
        <span className="font-mono text-xs text-muted-foreground">main {short(app?.commitId ?? data.spec?.commitId) || ""}</span>
        {app ? (
          <span title="Main's app is the release candidate" data-main-app={app.status}>
            <ToneBadge tone={APP_TONE[app.status]}>{APP_STATUS_LABEL[app.status]}</ToneBadge>
          </span>
        ) : null}
        <span className="flex-1" />
        <Button variant="ghost" size="icon-sm" onClick={() => expandPanel(!panelExpanded)} aria-label={panelExpanded ? "Make smaller" : "Open large"} title={panelExpanded ? "Make smaller" : "Open large"}>
          {panelExpanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </header>
      <div className="flex shrink-0 items-center border-b px-3 pb-2">
        <TabsList className="h-8 max-w-full justify-start">
          <TabsTrigger value="app" className="min-w-0 px-2.5 text-[13px]">
            App
          </TabsTrigger>
          <TabsTrigger value="history" className="min-w-0 px-2.5 text-[13px]">
            History
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="app" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <MainApp />
      </TabsContent>
      <TabsContent value="history" className="flex min-h-0 flex-1 flex-col">
        <HistoryView />
      </TabsContent>
    </Tabs>
  );
}
