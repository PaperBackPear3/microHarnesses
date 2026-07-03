import { type EventSink, type ExecutionEvent, MemoryEventSink } from "@micro-harness/core";

/**
 * Mirrors runtime events to an in-memory sink and streams compact progress to stderr.
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

    if (event.type === "tool.allowed") {
      this.writeCallLine("call", event.payload);
    }
    if (event.type === "tool.blocked") {
      this.writeCallLine("blocked", event.payload);
    }
    if (event.type === "tool.approval_requested") {
      this.writeCallLine("approval requested", event.payload);
    }
    if (event.type === "tool.approval_approved") {
      this.writeCallLine("approval granted", event.payload);
    }
    if (event.type === "tool.approval_denied") {
      this.writeCallLine("approval denied", event.payload);
    }

    if (event.type === "model.thinking_completed" || event.type === "run.completed") {
      this.stopSpinner(!this.streaming);
      this.streaming = false;
      this.indicatorMode = undefined;
    }

    await this.memory.push(event);
  }

  private writeCallLine(status: string, payload: Record<string, unknown>): void {
    const tool = typeof payload.tool === "string" ? payload.tool : "unknown";
    const label = isAgentTool(tool) ? "agent" : "tool";
    const summary = summarizeInput(payload.input);
    const reason = typeof payload.reason === "string" ? payload.reason : undefined;
    const parts = [`[${label}] ${status}: ${tool}`];
    if (summary.length > 0) {
      parts.push(`input=${summary}`);
    }
    if (reason && (status === "blocked" || status.startsWith("approval"))) {
      parts.push(`reason=${truncate(reason, 140)}`);
    }
    this.stopSpinner(false);
    process.stderr.write(`${parts.join(" ")}\n`);
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

function summarizeInput(input: unknown): string {
  if (typeof input === "undefined") {
    return "";
  }
  try {
    return truncate(JSON.stringify(input), 140);
  } catch {
    return "<unserializable>";
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function isAgentTool(toolName: string): boolean {
  return (
    toolName === "spawn_subagent" ||
    toolName.endsWith("_agent") ||
    toolName.includes("subagent") ||
    toolName.includes("agent")
  );
}
