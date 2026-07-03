import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall, ToolDefinition } from "../tools/types";
import { DefaultPolicyEngine } from "./defaultPolicyEngine";
import type { ToolPolicyContext } from "./types";

const ctx = (mode?: "strict" | "balanced" | "open"): ToolPolicyContext => ({
  runId: "r",
  iteration: 1,
  agentName: "a",
  safetyMode: mode,
});

const call: ToolCall = { name: "any", input: {} };

const lowTool: ToolDefinition = {
  name: "safe",
  description: "",
  risk: "low",
  async execute() {
    return {};
  },
};

const highTool: ToolDefinition = {
  name: "dangerous",
  description: "",
  risk: "high",
  async execute() {
    return {};
  },
};

test("low-risk tools are allowed by default", async () => {
  const engine = new DefaultPolicyEngine();
  const evaluation = await engine.evaluate(lowTool, call, ctx());
  assert.equal(evaluation.decision, "allow");
});

test("high-risk tools are denied by default", async () => {
  const engine = new DefaultPolicyEngine();
  const evaluation = await engine.evaluate(highTool, call, ctx());
  assert.equal(evaluation.decision, "deny");
  assert.match(evaluation.reason, /High-risk/);
});

test("high-risk tools require approval in open mode", async () => {
  const engine = new DefaultPolicyEngine();
  const evaluation = await engine.evaluate(highTool, call, ctx("open"));
  assert.equal(evaluation.decision, "require_approval");
});

test("allowlisted high-risk tools are allowed", async () => {
  const engine = new DefaultPolicyEngine({ allowedHighRiskTools: ["dangerous"] });
  const evaluation = await engine.evaluate(highTool, call, ctx());
  assert.equal(evaluation.decision, "allow");
});
