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
  /**
   * Optional richer risk/governance metadata. `risk` remains the canonical
   * coarse value used by default policy for backwards compatibility.
   */
  riskProfile?: ToolRiskProfile;
  /** Optional tool ownership/governance metadata. */
  governance?: ToolGovernance;
  /** Optional capabilities/tags used for discovery/catalog filtering. */
  capabilities?: string[];
  tags?: string[];
  /**
   * Optional structured schema used for provider-native tool/function calling.
   * When omitted, core derives a permissive object schema.
   */
  inputSchema?: Record<string, unknown>;
  /**
   * Optional annotations that mark specific input fields as dangerous kinds
   * (shell commands, file paths, URLs). Consumed by `CommandSafetyRule` and
   * other input-inspecting policy rules. When omitted, safety rules fall
   * back to a heuristic (see `CommandSafetyRule`).
   */
  inputAnnotations?: ToolInputAnnotation[];
  execute(
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<Record<string, unknown>>;
}

export interface ToolRiskProfile {
  level: "low" | "medium" | "high" | "critical";
  domains?: string[];
  notes?: string;
}

export interface ToolGovernance {
  owner?: string;
  version?: string;
  audit?: "none" | "basic" | "strict";
}

export type ToolInputAnnotationKind = "shell_command" | "file_path" | "url" | "text";

export interface ToolInputAnnotation {
  /** Dot-path into the tool's input object (e.g. `"command"`, `"args.path"`). */
  field: string;
  kind: ToolInputAnnotationKind;
}

/**
 * Passed to every tool execution. Tools MUST honor `signal`: the runtime
 * aborts it on timeout or kill, but cannot forcibly stop a tool that ignores it.
 */
export interface ToolExecutionContext {
  signal: AbortSignal;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCatalogQuery {
  capability?: string;
  tag?: string;
  owner?: string;
}

export interface ToolCatalogEntry {
  name: string;
  description: string;
  risk: ToolDefinition["risk"];
  capabilities: string[];
  tags: string[];
  governance?: ToolGovernance;
}
