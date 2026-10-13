import { useSyncExternalStore } from "react";
import { startTalk, transcript, type Call, type Heard, type Levels } from "./voice";

export type Phase = "off" | "starting" | "connecting" | "listening";

export interface TalkState {
  readonly project: string | null;
  readonly phase: Phase;
  readonly sessionId: string | null;
  readonly heard: readonly Heard[];
  readonly muted: boolean;
}

const OFF: TalkState = { project: null, phase: "off", sessionId: null, heard: [], muted: false };

let state: TalkState = OFF;
let call: Call | null = null;
let attempt = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<TalkState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTalk(): TalkState {
  return useSyncExternalStore(subscribe, () => state, () => OFF);
}

export function talkState(): TalkState {
  return state;
}

export function levels(): Levels {
  return call?.levels() ?? { you: 0, chef: 0 };
}

export function plainVoiceError(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) return "Allow the microphone for this site in your browser, then try again.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone was found on this device.";
  return error instanceof Error ? error.message : String(error);
}

export async function startLive(project: string): Promise<void> {
  if (state.phase !== "off") return;
  const mine = ++attempt;
  set({ project, phase: "starting", sessionId: null, heard: [], muted: false });
  try {
    const started = await startTalk({
      project,
      onStatus: (status) => {
        if (mine === attempt && (status === "connecting" || status === "listening") && state.phase !== "off") set({ phase: status });
      },
      onEvent: (event) => {
        if (mine !== attempt) return;
        set({ heard: transcript(state.heard, event) });
        if (event.type === "session.closed") void endLive();
      },
    });
    if (mine !== attempt) {
      void started.end();
      return;
    }
    call = started;
    set({ sessionId: started.sessionId, phase: talkState().phase === "starting" ? "connecting" : talkState().phase });
  } catch (error) {
    if (mine !== attempt) return;
    set({ phase: "off" });
    throw error;
  }
}

export function endLive(): Promise<void> {
  if (state.phase === "off") return Promise.resolve();
  const ending = call;
  call = null;
  attempt++;
  set({ phase: "off", muted: false });
  return ending ? ending.end().catch(() => {}) : Promise.resolve();
}

export function setMuted(muted: boolean): void {
  call?.mute(muted);
  set({ muted });
}
