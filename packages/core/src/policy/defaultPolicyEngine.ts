import type { ToolCall, ToolDefinition } from "../tools/types";
import type { ToolPolicyContext, ToolPolicyEngine, ToolPolicyEvaluation } from "./types";

export interface DefaultPolicyOptions {
  allowedHighRiskTools?: string[];
}

export class DefaultPolicyEngine implements ToolPolicyEngine {
  private readonly allowedHighRiskTools: Set<string>;

  constructor(options: DefaultPolicyOptions = {}) {
    this.allowedHighRiskTools = new Set(options.allowedHighRiskTools ?? []);
  }

  async evaluate(
    tool: ToolDefinition,
    _call: ToolCall,
    _context: ToolPolicyContext,
  ): Promise<ToolPolicyEvaluation> {
    if (tool.risk === "high" && !this.allowedHighRiskTools.has(tool.name)) {
      if (_context.safetyMode === "open") {
        return {
          decision: "require_approval",
          reason: `High-risk tool "${tool.name}" requires approval in open mode`,
        };
      }
      return {
        decision: "deny",
        reason: `High-risk tool "${tool.name}" denied by default policy`,
      };
    }
    return {
      decision: "allow",
      reason: "Allowed by default policy",
    };
  }
}
