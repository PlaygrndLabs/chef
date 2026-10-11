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

export interface VoiceOffer {
  readonly sdp: string;
  readonly instructions: string;
}

export interface VoiceHost {
  readonly model: string;
  open(offer: VoiceOffer): Promise<{ readonly sessionId: string; readonly sdp: string }>;
  attach(sessionId: string, onEvent: (event: LiveEvent) => void): Promise<LiveConnection>;
}
