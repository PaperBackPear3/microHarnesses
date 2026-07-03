import { type EventSink, type ExecutionEvent, MemoryEventSink } from "@micro-harness/core";

/**
 * Mirrors runtime events to an in-memory sink and streams compact progress to stderr.
 * Final state JSON remains on stdout.
 */
export class LiveEventSink implements EventSink {
  private readonly memory = new MemoryEventSink();
  private readonly spinnerFrames = ["|", "/", "-", "\\"];
  private spinnerTimer: NodeJS.Timeout | undefined;
  private spinnerIndex = 0;
  private indicatorMode: "default" | "reasoning" | "fast" | undefined;
  private streaming = false;

  async push(event: ExecutionEvent): Promise<void> {
    if (event.type === "model.thinking_started") {
      const taskType = event.payload.taskType;
      this.indicatorMode =
        taskType === "reasoning" || taskType === "fast" || taskType === "default"
          ? taskType
          : "default";
      this.startSpinner();
    }

    if (event.type === "model.delta") {
      this.stopSpinner(false);
      this.streaming = true;
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
      this.streaming = false;
      this.indicatorMode = undefined;
    }

    if (event.type === "model.thinking_completed" || event.type === "run.completed") {
      this.stopSpinner(!this.streaming);
      this.streaming = false;
      this.indicatorMode = undefined;
    }

    await this.memory.push(event);
  }

  private startSpinner(): void {
    this.stopSpinner(false);
    this.spinnerIndex = 0;
    this.renderSpinner();
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this.renderSpinner();
    }, 90);
  }

  private renderSpinner(): void {
    const mode = this.indicatorMode ?? "default";
    const label = mode === "reasoning" ? "reasoning" : "thinking";
    const frame = this.spinnerFrames[this.spinnerIndex];
    process.stderr.write(`\r[${label}] ${frame}`);
  }

  private stopSpinner(withNewline: boolean): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = undefined;
      process.stderr.write("\r                \r");
      if (withNewline) {
        process.stderr.write("\n");
      }
    }
  }
}
