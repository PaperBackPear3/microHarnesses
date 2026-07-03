import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall, ToolDefinition } from "../tools/types";
import { CompositePolicyEngine } from "./compositePolicyEngine";
import type {
  PolicyRule,
  ToolPolicyContext,
  ToolPolicyEngine,
  ToolPolicyEvaluation,
} from "./types";

const ctx: ToolPolicyContext = {
  runId: "r",
  iteration: 1,
  agentName: "a",
  safetyMode: "balanced",
};

const call: ToolCall = { name: "t", input: {} };

const tool: ToolDefinition = {
  name: "t",
  description: "",
  risk: "low",
  async execute() {
    return {};
  },
};

class FixedBase implements ToolPolicyEngine {
  constructor(private readonly evaluation: ToolPolicyEvaluation) {}
  async evaluate(): Promise<ToolPolicyEvaluation> {
    return this.evaluation;
  }
}

test("composite returns base's decision when no rules oppose it", async () => {
  const engine = new CompositePolicyEngine(new FixedBase({ decision: "allow", reason: "base ok" }));
  const evaluation = await engine.evaluate(tool, call, ctx);
  assert.equal(evaluation.decision, "allow");
});

test("composite picks the most restrictive decision (deny > require_approval > allow)", async () => {
  const engine = new CompositePolicyEngine(new FixedBase({ decision: "allow", reason: "base" }), [
    (() => ({ decision: "require_approval", reason: "rule1" })) satisfies PolicyRule,
    (() => ({ decision: "deny", reason: "rule2" })) satisfies PolicyRule,
  ]);
  const evaluation = await engine.evaluate(tool, call, ctx);
  assert.equal(evaluation.decision, "deny");
  assert.match(evaluation.reason, /rule2/);
});

test("composite ignores rules that return undefined", async () => {
  const engine = new CompositePolicyEngine(new FixedBase({ decision: "allow", reason: "base" }), [
    (() => undefined) satisfies PolicyRule,
    (() => undefined) satisfies PolicyRule,
  ]);
  const evaluation = await engine.evaluate(tool, call, ctx);
  assert.equal(evaluation.decision, "allow");
});

test("composite concatenates reasons from rules with the winning decision", async () => {
  const engine = new CompositePolicyEngine(new FixedBase({ decision: "allow", reason: "base" }), [
    (() => ({ decision: "deny", reason: "reason-a" })) satisfies PolicyRule,
    (() => ({ decision: "deny", reason: "reason-b" })) satisfies PolicyRule,
    (() => ({ decision: "require_approval", reason: "not-included" })) satisfies PolicyRule,
  ]);
  const evaluation = await engine.evaluate(tool, call, ctx);
  assert.equal(evaluation.decision, "deny");
  assert.match(evaluation.reason, /reason-a/);
  assert.match(evaluation.reason, /reason-b/);
  assert.ok(!/not-included/.test(evaluation.reason));
});

test("addRule appends rules that still combine", async () => {
  const engine = new CompositePolicyEngine(new FixedBase({ decision: "allow", reason: "base" }));
  engine.addRule(() => ({ decision: "deny", reason: "late" }));
  const evaluation = await engine.evaluate(tool, call, ctx);
  assert.equal(evaluation.decision, "deny");
});
