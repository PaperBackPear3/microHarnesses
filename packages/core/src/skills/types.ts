import type { ToolCall, ToolResult } from "../tools/types";

export interface SkillExecutionContext {
  signal?: AbortSignal;
}

export interface SkillDefinition {
  name: string;
  description: string;
  /**
   * Coarse risk used by the policy engine when the skill runs through the
   * governed execution pipeline (same as tools). Defaults to `"low"`.
   */
  risk?: "low" | "high";
  tags?: string[];
  capabilities?: string[];
  inputSchema?: Record<string, unknown>;
  execute(
    input: Record<string, unknown>,
    context?: SkillExecutionContext,
  ): Promise<Record<string, unknown>>;
}

/** Skills share the tool call/result shape and the governed execution path. */
export type SkillCall = ToolCall;
export type SkillResult = ToolResult;

export interface SkillCatalogQuery {
  tag?: string;
  capability?: string;
}
