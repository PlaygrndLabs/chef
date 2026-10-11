import type { KargahEvent } from "../events/events.ts";

export interface EventBus {
  publish(event: KargahEvent): Promise<void>;
  subscribe(listener: (event: KargahEvent) => void): () => void;
}
