import type { EventBus, ChefEvent } from "@chef/core";

export class DurableEventBus implements EventBus {
  private readonly listeners = new Set<(event: ChefEvent) => void>();

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly broadcast: (message: string) => void,
    private readonly keep = 5000,
  ) {}

  async publish(event: ChefEvent): Promise<void> {
    const seq = ((await this.storage.get<number>("event-seq")) ?? 0) + 1;
    await this.storage.put({ "event-seq": seq, [`event/${String(seq).padStart(10, "0")}`]: event });
    if (seq > this.keep) await this.storage.delete(`event/${String(seq - this.keep).padStart(10, "0")}`);
    this.broadcast(JSON.stringify({ seq, event }));
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener: (event: ChefEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async cursor(): Promise<number> {
    return (await this.storage.get<number>("event-seq")) ?? 0;
  }

  async since(after: number, limit = 500): Promise<{ seq: number; event: ChefEvent }[]> {
    const entries = await this.storage.list<ChefEvent>({ prefix: "event/", start: `event/${String(after + 1).padStart(10, "0")}`, limit });
    return [...entries].map(([key, event]) => ({ seq: Number(key.slice(6)), event }));
  }
}
