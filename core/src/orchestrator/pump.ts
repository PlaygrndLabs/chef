import type { SessionRecord } from "../session/record.ts";
import { runnable, type Orchestrator } from "./orchestrator.ts";

export type KeepAlive = (work: () => Promise<void>) => Promise<void>;

export class SessionPump {
  private readonly stepping = new Set<string>();

  constructor(private readonly keep: KeepAlive = (work) => work()) {}

  async kick(orchestrator: Orchestrator, settled: (id: string) => void): Promise<SessionRecord[]> {
    const sessions = await orchestrator.sessions();
    for (const session of sessions.filter(runnable)) {
      if (this.stepping.has(session.id)) continue;
      this.stepping.add(session.id);
      void this.keep(() => orchestrator.step(session.id))
        .catch((error: unknown) => console.error(`step ${session.id} failed`, error))
        .finally(() => {
          this.stepping.delete(session.id);
          settled(session.id);
        });
    }
    return sessions;
  }

  busy(): boolean {
    return this.stepping.size > 0;
  }
}
