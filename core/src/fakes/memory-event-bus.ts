import type { KargahEvent } from "../events/events.ts";
import type { EventBus } from "../ports/event-bus.ts";

export class MemoryEventBus implements EventBus {
  readonly log: KargahEvent[] = [];
  private readonly listeners = new Set<(event: KargahEvent) => void>();

  async publish(event: KargahEvent): Promise<void> {
    this.log.push(event);
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener: (event: KargahEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  count(type: KargahEvent["type"]): number {
    return this.log.filter((event) => event.type === type).length;
  }
}
