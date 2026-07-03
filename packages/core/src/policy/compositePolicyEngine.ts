import type { ToolCall, ToolDefinition } from "../tools/types";
import type {
  PolicyDecision,
  PolicyRule,
  ToolPolicyContext,
  ToolPolicyEngine,
  ToolPolicyEvaluation,
} from "./types";

const RESTRICTIVENESS: Record<PolicyDecision, number> = {
  deny: 3,
  require_approval: 2,
  allow: 0,
};

/**
 * Combines a base engine with registered policy rules. Every rule runs;
 * the most restrictive decision wins and its reasons are concatenated.
 */
export class CompositePolicyEngine implements ToolPolicyEngine {
  private readonly base: ToolPolicyEngine;
  private readonly rules: PolicyRule[] = [];

  constructor(base: ToolPolicyEngine, rules: PolicyRule[] = []) {
    this.base = base;
    this.rules.push(...rules);
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  async evaluate(
    tool: ToolDefinition,
    call: ToolCall,
    context: ToolPolicyContext,
  ): Promise<ToolPolicyEvaluation> {
    const evaluations: ToolPolicyEvaluation[] = [await this.base.evaluate(tool, call, context)];
    for (const rule of this.rules) {
      const evaluation = await rule(tool, call, context);
      if (evaluation) {
        evaluations.push(evaluation);
      }
    }

    let winner = evaluations[0] as ToolPolicyEvaluation;
    for (const evaluation of evaluations) {
      if (RESTRICTIVENESS[evaluation.decision] > RESTRICTIVENESS[winner.decision]) {
        winner = evaluation;
      }
    }
    if (winner.decision === "allow") {
      return winner;
    }
    const reasons = evaluations
      .filter((evaluation) => evaluation.decision === winner.decision)
      .map((evaluation) => evaluation.reason);
    return { decision: winner.decision, reason: reasons.join("; ") };
  }
}
