import type { EventSink, ExecutionEvent } from "@micro-harness/core";

/**
 * Streams compact runtime progress to stderr.
 */
export class LiveEventSink implements EventSink {
  private readonly spinnerFrames = ["|", "/", "-", "\\"];
  private spinnerTimer: NodeJS.Timeout | undefined;
  private spinnerIndex = 0;
  private indicatorMode: "default" | "reasoning" | "fast" | undefined;
  private activeSpinnerLabel: "thinking" | "reasoning" = "thinking";
  private streamingAssistant = false;
  private streamingReasoning = false;

  async push(event: ExecutionEvent): Promise<void> {
    if (event.type === "model.thinking_started") {
      const taskType = event.payload.taskType;
      this.indicatorMode =
        taskType === "reasoning" || taskType === "fast" || taskType === "default"
          ? taskType
          : "default";
      this.startSpinner();
      return;
    }

    if (event.type === "model.reasoning_delta") {
      this.stopSpinner(true);
      if (!this.streamingReasoning) {
        process.stderr.write("[reasoning] ");
        this.streamingReasoning = true;
      }
      const delta = event.payload.delta;
      if (typeof delta === "string" && delta.length > 0) {
        process.stderr.write(delta);
      }
      return;
    }

    if (event.type === "model.reasoning_stream_completed") {
      const chars = event.payload.chars;
      if (typeof chars === "number" && chars > 0) {
        process.stderr.write("\n");
      }
      this.streamingReasoning = false;
      return;
    }

    if (event.type === "model.delta") {
      this.stopSpinner(true);
      this.streamingAssistant = true;
      const delta = event.payload.delta;
      if (typeof delta === "string" && delta.length > 0) {
        process.stderr.write(delta);
      }
      return;
    }

    if (event.type === "model.stream_completed") {
      const chars = event.payload.chars;
      if (typeof chars === "number" && chars > 0) {
        process.stderr.write("\n");
      }
      this.streamingAssistant = false;
      this.indicatorMode = undefined;
      return;
    }

    if (event.type === "tool.allowed") {
      this.writeCallLine("call", event.payload);
      return;
    }
    if (event.type === "tool.blocked") {
      this.writeCallLine("blocked", event.payload);
      return;
    }
    if (event.type === "tool.approval_requested") {
      this.writeCallLine("approval requested", event.payload);
      return;
    }
    if (event.type === "tool.approval_approved") {
      this.writeCallLine("approval granted", event.payload);
      return;
    }
    if (event.type === "tool.approval_denied") {
      this.writeCallLine("approval denied", event.payload);
      return;
    }

    if (event.type === "model.thinking_completed" || event.type === "run.completed") {
      this.stopSpinner(!this.streamingAssistant && !this.streamingReasoning);
      if (event.type === "run.completed") {
        this.streamingAssistant = false;
        this.streamingReasoning = false;
      }
    }
  }

  reset(): void {
    this.stopSpinner(true);
    this.streamingAssistant = false;
    this.streamingReasoning = false;
    this.indicatorMode = undefined;
    this.spinnerIndex = 0;
  }

  private writeCallLine(status: string, payload: Record<string, unknown>): void {
    this.stopSpinner(true);
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
    process.stderr.write(`${parts.join(" ")}\n`);
  }

  private startSpinner(): void {
    this.stopSpinner(false);
    this.spinnerIndex = 0;
    const mode = this.indicatorMode ?? "default";
    this.activeSpinnerLabel = mode === "reasoning" ? "reasoning" : "thinking";
    this.renderSpinner();
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this.renderSpinner();
    }, 90);
  }

  private renderSpinner(): void {
    const frame = this.spinnerFrames[this.spinnerIndex];
    process.stderr.write(`\r[${this.activeSpinnerLabel}] ${frame}`);
  }

  private stopSpinner(withNewline: boolean): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
    if (withNewline) {
      process.stderr.write("\n");
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
  return toolName === "spawn_subagent" || toolName.endsWith("_agent");
}
