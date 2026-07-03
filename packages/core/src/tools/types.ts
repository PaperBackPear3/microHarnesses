export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  /** Set when the model produced arguments that could not be parsed; the call is not executed. */
  malformedInput?: boolean;
}

export interface ToolResult {
  ok: boolean;
  output: Record<string, unknown>;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: "low" | "high";
  execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<Record<string, unknown>>;
}

/**
 * Passed to every tool execution. Tools MUST honor `signal`: the runtime
 * aborts it on timeout or kill, but cannot forcibly stop a tool that ignores it.
 */
export interface ToolExecutionContext {
  signal: AbortSignal;
}
