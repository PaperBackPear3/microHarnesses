import type { EventSink, ExecutionEvent } from "./types";

export class MemoryEventSink implements EventSink {
  private readonly events: ExecutionEvent[] = [];

  async push(event: ExecutionEvent): Promise<void> {
    this.events.push(event);
  }

  list(): ExecutionEvent[] {
    return [...this.events];
  }
}
