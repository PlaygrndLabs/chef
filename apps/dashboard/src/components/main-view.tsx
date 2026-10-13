import { useEffect, useRef } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { Home } from "@/components/home";
import { useWorkspace } from "@/lib/workspace";

function Chat() {
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const focus = () => composer.current?.focus();
    window.addEventListener("chef:compose", focus);
    return () => window.removeEventListener("chef:compose", focus);
  }, []);
  return <Home composerRef={composer} />;
}

export function MainView() {
  const { selection } = useWorkspace();
  return (
    <CopilotKitProvider runtimeUrl={`/api/projects/${selection.project}/copilotkit`}>
      <Chat />
    </CopilotKitProvider>
  );
}
