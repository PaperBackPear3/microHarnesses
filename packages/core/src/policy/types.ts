import type { ToolCall, ToolDefinition } from "../tools/types";

export type SafetyMode = "strict" | "balanced" | "open";

export type PolicyDecision = "allow" | "deny" | "require_approval";

export interface ToolPolicyEvaluation {
  decision: PolicyDecision;
  reason: string;
}

export interface ToolPolicyContext {
  iteration: number;
  promptName: string;
  runId: string;
  safetyMode?: SafetyMode;
  parentSessionId?: string;
  parentRunId?: string;
  rootSessionId?: string;
  depth?: number;
}

export interface ToolPolicyEngine {
  evaluate(
    tool: ToolDefinition,
    call: ToolCall,
    context: ToolPolicyContext,
  ): Promise<ToolPolicyEvaluation>;
}

/**
 * Composable policy check. Return `undefined` for "no opinion"; returned
 * evaluations are combined most-restrictive-wins by the CompositePolicyEngine.
 */
export type PolicyRule = (
  tool: ToolDefinition,
  call: ToolCall,
  context: ToolPolicyContext,
) => Promise<ToolPolicyEvaluation | undefined> | ToolPolicyEvaluation | undefined;
