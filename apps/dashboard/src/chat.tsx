import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CopilotChat, CopilotKitProvider, useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import type { KargahState, SessionView } from "@kargah/adapters/agui";

const short = (id: string | null) => (id ? id.slice(0, 12) : "");

function SessionCard({ session }: { readonly session: SessionView }) {
  return (
    <div className="card" data-session={session.id} data-state={session.state}>
      <div>
        <code>{session.featureId}</code> <span className={`pill state-${session.state}`}>{session.state}</span>
      </div>
      <div className="muted">
        {short(session.id)}
        {session.attempt ? ` attempt ${session.attempt}` : ""}
      </div>
      <div>{session.commits === 1 ? "1 commit" : `${session.commits} commits`}</div>
      {session.preview ? (
        <div>
          preview{" "}
          <a href={session.preview} target="_blank" rel="noreferrer">
            {session.preview.replace(/^https?:\/\//, "")}
          </a>
        </div>
      ) : null}
      {session.review ? <div>review {session.review}</div> : null}
      {session.gate ? <div>gate {session.gate}</div> : null}
      {session.merged ? <div className="state-merged">merged {short(session.merged)}</div> : null}
      {session.stuck ? <div className="state-stuck">stuck: {session.stuck}</div> : null}
    </div>
  );
}

function LiveSessions() {
  const { agent } = useAgent({ agentId: "default", updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged] });
  const state = agent.state as Partial<KargahState> | undefined;
  const sessions = Object.values(state?.sessions ?? {});
  if (sessions.length === 0) return null;
  return (
    <div className="cards" id="live-sessions">
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}

function Chat() {
  const [project, setProject] = useState(() => new URLSearchParams(location.search).get("project") || "demo");
  useEffect(() => {
    const onProject = (event: Event) => setProject((event as CustomEvent<string>).detail);
    document.addEventListener("kargah:project", onProject);
    return () => document.removeEventListener("kargah:project", onProject);
  }, []);
  return (
    <CopilotKitProvider key={project} runtimeUrl={`/api/projects/${project}/copilotkit`}>
      <div className="chat">
        <CopilotChat agentId="default" labels={{ chatInputPlaceholder: "Describe a feature or a change" }} />
      </div>
      <LiveSessions />
    </CopilotKitProvider>
  );
}

const mount = document.getElementById("chat");
if (mount)
  createRoot(mount).render(
    <StrictMode>
      <Chat />
    </StrictMode>,
  );
