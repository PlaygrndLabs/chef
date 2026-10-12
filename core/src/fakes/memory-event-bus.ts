import type { ChefEvent } from "../events/events.ts";
import type { EventBus } from "../ports/event-bus.ts";

export class MemoryEventBus implements EventBus {
  readonly log: ChefEvent[] = [];
  private readonly listeners = new Set<(event: ChefEvent) => void>();

  async publish(event: ChefEvent): Promise<void> {
    this.log.push(event);
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener: (event: ChefEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  count(type: ChefEvent["type"]): number {
    return this.log.filter((event) => event.type === type).length;
  }
}
