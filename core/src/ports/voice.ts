export interface LiveEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type LiveCommand =
  | { readonly type: "session.commentary.append"; readonly event_id: string; readonly delegation_id: string; readonly content: string }
  | { readonly type: "session.thinking.append"; readonly event_id: string; readonly delegation_id: string; readonly content: string }
  | { readonly type: "session.instructions.append"; readonly event_id: string; readonly delegation_id: null; readonly content: string }
  | { readonly type: "session.close"; readonly event_id: string };

export interface LiveConnection {
  send(command: LiveCommand): void;
  close(): Promise<void>;
}

export interface VoiceStream {
  readonly sessionId: string;
  readonly connection: LiveConnection;
  sendAudio(pcm: Uint8Array): void;
}

export interface VoiceHost {
  readonly model: string;
  start(input: { readonly instructions: string; readonly onEvent: (event: LiveEvent) => void }): Promise<VoiceStream>;
}
