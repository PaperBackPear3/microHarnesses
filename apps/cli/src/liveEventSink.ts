import { type EventSink, type ExecutionEvent, MemoryEventSink } from "@micro-harness/core";

/**
 * Mirrors runtime events to an in-memory sink and streams assistant deltas to stderr.
 * Final state JSON remains on stdout.
 */
export class LiveEventSink implements EventSink {
  private readonly memory = new MemoryEventSink();

  async push(event: ExecutionEvent): Promise<void> {
    if (event.type === "model.delta") {
      const delta = event.payload.delta;
      if (typeof delta === "string" && delta.length > 0) {
        process.stderr.write(delta);
      }
    }
    if (event.type === "model.stream_completed") {
      const chars = event.payload.chars;
      if (typeof chars === "number" && chars > 0) {
        process.stderr.write("\n");
      }
    }
    await this.memory.push(event);
  }
}
