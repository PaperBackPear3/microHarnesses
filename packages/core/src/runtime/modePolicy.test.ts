import assert from "node:assert/strict";
import { test } from "node:test";
import type { ToolDefinition } from "../tools/types";
import { ModeController, createModeAwareApprovalPolicy } from "./modes";

const writeTool: ToolDefinition = {
  name: "fs_write",
  description: "write",
  risk: "high",
  async execute() {
    return {};
  },
};

const readTool: ToolDefinition = {
  name: "fs_read",
  description: "read",
  risk: "low",
  async execute() {
    return {};
  },
};

test("plan mode denies mutating tools", async () => {
  const mode = new ModeController("plan");
  const rule = createModeAwareApprovalPolicy(mode);
  const decision = await rule(
    writeTool,
    { name: "fs_write", input: {} },
    {
      iteration: 1,
      promptName: "coder",
      runId: "r-1",
    },
  );
  assert.equal(decision?.decision, "deny");
});

test("accept-edits mode requires approval for mutating tools", async () => {
  const mode = new ModeController("accept-edits");
  const rule = createModeAwareApprovalPolicy(mode);
  const decision = await rule(
    writeTool,
    { name: "fs_write", input: {} },
    {
      iteration: 1,
      promptName: "coder",
      runId: "r-1",
    },
  );
  assert.equal(decision?.decision, "require_approval");
});

test("accept-edits mode allows read tools", async () => {
  const mode = new ModeController("accept-edits");
  const rule = createModeAwareApprovalPolicy(mode);
  const decision = await rule(
    readTool,
    { name: "fs_read", input: {} },
    {
      iteration: 1,
      promptName: "coder",
      runId: "r-1",
    },
  );
  assert.equal(decision?.decision, "allow");
});
