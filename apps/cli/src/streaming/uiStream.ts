import { EventEmitter } from "node:events";
import type { StreamEvent, StreamSink } from "@micro-harnesses/core";

export interface UiStreamEvent {
  streamEvent: StreamEvent;
}

export class UiStream implements StreamSink {
  private readonly emitter = new EventEmitter();

  push(event: StreamEvent): void {
    this.emitter.emit("event", { streamEvent: event } satisfies UiStreamEvent);
  }

  subscribe(listener: (event: UiStreamEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }
}
