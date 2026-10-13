import { useEffect, useRef } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { Button } from "@/components/ui/button";
import { FeaturePage } from "@/components/feature-page";
import { Home } from "@/components/home";
import { InsightsView } from "@/components/insights-view";
import { PageSkeleton } from "@/components/loading";
import { useWorkspace } from "@/lib/workspace";

function Missing() {
  const { select } = useWorkspace();
  return (
    <div className="grid h-full place-items-center p-6 text-center" data-view="missing">
      <div className="flex flex-col items-center gap-3">
        <p className="text-muted-foreground">This feature or build is not in the project.</p>
        <Button variant="outline" size="sm" onClick={() => select({ view: "project", feature: null, session: null, panel: null })}>
          Back to the chat
        </Button>
      </div>
    </div>
  );
}

function Center() {
  const composer = useRef<HTMLTextAreaElement>(null);
  const { selection, feature, data } = useWorkspace();
  useEffect(() => {
    const focus = () => composer.current?.focus();
    window.addEventListener("chef:compose", focus);
    return () => window.removeEventListener("chef:compose", focus);
  }, []);
  if (selection.view === "project") return <Home composerRef={composer} />;
  if (!data.ready) return <PageSkeleton />;
  if (selection.view === "insights") return <InsightsView />;
  return feature ? <FeaturePage feature={feature} composerRef={composer} /> : <Missing />;
}

export function MainView() {
  const { selection } = useWorkspace();
  return (
    <CopilotKitProvider runtimeUrl={`/api/projects/${selection.project}/copilotkit`}>
      <Center />
    </CopilotKitProvider>
  );
}
