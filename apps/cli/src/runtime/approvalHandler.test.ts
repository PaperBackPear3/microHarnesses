import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApprovalRequest, ToolDefinition } from "@micro-harnesses/core";
import { ApprovalController, type ApprovalView } from "./approvalHandler.js";

const tool: ToolDefinition = {
  name: "shell_exec",
  description: "run",
  risk: "high",
  async execute() {
    return {};
  },
};

function makeRequest(): ApprovalRequest {
  return {
    runId: "r-1",
    iteration: 1,
    promptName: "coder",
    tool,
    call: { name: "shell_exec", input: { command: "ls" } },
    reason: "needs approval",
  };
}

test("non-interactive controller auto-denies", async () => {
  const controller = new ApprovalController(process.cwd(), false);
  const handler = controller.createHandler(() => "accept-edits");
  const approved = await handler(makeRequest());
  assert.equal(approved, false);
});

test("autopilot mode auto-approves regardless of interactivity", async () => {
  const controller = new ApprovalController(process.cwd(), false);
  const handler = controller.createHandler(() => "autopilot");
  const approved = await handler(makeRequest());
  assert.equal(approved, true);
});

test("interactive approval notifies subscribers and resolves on approve", async () => {
  const controller = new ApprovalController(process.cwd(), true);
  const seen: (ApprovalView | undefined)[] = [];
  controller.subscribe((pending) => seen.push(pending));

  const handler = controller.createHandler(() => "accept-edits");
  const decision = handler(makeRequest());

  await tick();
  assert.ok(controller.getPending(), "pending should be set after handler awaits");
  assert.ok(seen.some((view) => view?.request.tool.name === "shell_exec"));

  controller.resolvePending("approve");
  assert.equal(await decision, true);
  assert.equal(controller.getPending(), undefined);
});

test("cancelPending rejects the in-flight approval", async () => {
  const controller = new ApprovalController(process.cwd(), true);
  const handler = controller.createHandler(() => "accept-edits");
  const decision = handler(makeRequest());
  await tick();
  assert.ok(controller.getPending());
  controller.cancelPending();
  assert.equal(await decision, false);
  assert.equal(controller.getPending(), undefined);
});

test("always-allow approves subsequent calls for the same tool", async () => {
  const controller = new ApprovalController(process.cwd(), true);
  const handler = controller.createHandler(() => "accept-edits");
  const first = handler(makeRequest());
  await tick();
  controller.resolvePending("always");
  assert.equal(await first, true);

  const second = await handler(makeRequest());
  assert.equal(second, true);
  assert.equal(controller.getPending(), undefined);
});

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
