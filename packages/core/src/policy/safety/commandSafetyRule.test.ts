import assert from "node:assert/strict";
import test from "node:test";
import type { ToolCall, ToolDefinition } from "../../tools/types";
import type { ToolPolicyContext } from "../types";
import { createCommandSafetyRule } from "./commandSafetyRule";

const ctx = (mode?: "strict" | "balanced" | "open"): ToolPolicyContext => ({
  runId: "r",
  iteration: 1,
  agentName: "a",
  safetyMode: mode,
});

const bashTool: ToolDefinition = {
  name: "bash",
  description: "",
  risk: "high",
  inputAnnotations: [{ field: "command", kind: "shell_command" }],
  async execute() {
    return {};
  },
};

const fileTool: ToolDefinition = {
  name: "write_file",
  description: "",
  risk: "low",
  inputAnnotations: [{ field: "path", kind: "file_path" }],
  async execute() {
    return {};
  },
};

const unannotated: ToolDefinition = {
  name: "shell_wrapper",
  description: "",
  risk: "low",
  async execute() {
    return {};
  },
};

const call = (input: Record<string, unknown>): ToolCall => ({ name: "bash", input });

test("blocks sudo in balanced mode", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: "sudo rm -rf /" }), ctx("balanced"));
  assert.ok(result);
  assert.equal(result?.decision, "deny");
});

test("blocks rm -rf variants (rm -fr ~)", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: "rm -fr ~" }), ctx("balanced"));
  assert.ok(result);
  assert.equal(result?.decision, "deny");
});

test("detects sudo behind && chain", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: "echo hi && sudo x" }), ctx("balanced"));
  assert.ok(result);
  assert.equal(result?.decision, "deny");
});

test("defeats backslash bypass s\\udo", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: "s\\udo rm -rf /" }), ctx("balanced"));
  assert.ok(result);
  assert.equal(result?.decision, "deny");
});

test('defeats quote bypass "su"do', async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: '"su"do rm -rf /' }), ctx("balanced"));
  assert.ok(result);
  assert.equal(result?.decision, "deny");
});

test("does not fire on benign echo containing dangerous words in quoted string", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: "git status" }), ctx("balanced"));
  assert.equal(result, undefined);
});

test("severity × safetyMode: critical → require_approval in open mode", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: "sudo x" }), ctx("open"));
  assert.equal(result?.decision, "require_approval");
});

test("severity × safetyMode: high → require_approval in balanced mode", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: "chmod 777 /etc" }), ctx("balanced"));
  assert.equal(result?.decision, "require_approval");
});

test("severity × safetyMode: high → deny in strict mode", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(bashTool, call({ command: "chmod 777 /etc" }), ctx("strict"));
  assert.equal(result?.decision, "deny");
});

test("path rule detects workspace escape", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(
    fileTool,
    { name: "write_file", input: { path: "../../etc/passwd" } },
    ctx("balanced"),
  );
  assert.ok(result);
  assert.equal(result?.decision, "require_approval");
});

test("heuristic fallback triggers on tool named /shell/", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(
    unannotated,
    { name: "shell_wrapper", input: { command: "sudo x" } },
    ctx("balanced"),
  );
  assert.ok(result);
  assert.equal(result?.decision, "deny");
});

test("heuristic fallback can be disabled", async () => {
  const rule = createCommandSafetyRule({ useHeuristicFallback: false });
  const result = await rule(
    unannotated,
    { name: "shell_wrapper", input: { command: "sudo x" } },
    ctx("balanced"),
  );
  assert.equal(result, undefined);
});

test("no annotations + non-heuristic tool name → no opinion", async () => {
  const rule = createCommandSafetyRule();
  const result = await rule(
    { ...unannotated, name: "friendly_tool" },
    { name: "friendly_tool", input: { command: "sudo x" } },
    ctx("balanced"),
  );
  assert.equal(result, undefined);
});
