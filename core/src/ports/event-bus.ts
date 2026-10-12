import type { ChefEvent } from "../events/events.ts";

export interface EventBus {
  publish(event: ChefEvent): Promise<void>;
  subscribe(listener: (event: ChefEvent) => void): () => void;
}
