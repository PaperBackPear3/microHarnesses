import assert from "node:assert/strict";
import test from "node:test";
import { ApprovalController } from "../../runtime/approvalHandler.js";
import { UiStream } from "../../streaming/uiStream.js";
import { ChatStore } from "./chatStore.js";

test("routes top-level model output into transcript", () => {
  const ui = new UiStream();
  const approvals = new ApprovalController(process.cwd());
  const store = new ChatStore(ui, approvals, "2.0.0");
  store.startTurn("hello");
  store.setActiveRunSession("s-1");

  ui.push({
    type: "model.output_delta",
    sessionId: "s-1",
    payload: { delta: "world", iteration: 1 },
  } as never);

  const snapshot = store.getSnapshot();
  const text = snapshot.entries[1]?.turn?.steps?.[0]?.assistantText;
  assert.equal(text, "world");
  store.dispose();
});

test("does not include subagent output in main transcript", () => {
  const ui = new UiStream();
  const approvals = new ApprovalController(process.cwd());
  const store = new ChatStore(ui, approvals, "2.0.0");
  store.startTurn("hello");
  store.setActiveRunSession("s-root");

  ui.push({
    type: "run.started",
    sessionId: "s-sub",
    payload: { kind: "subagent", promptName: "goal-finder" },
  } as never);
  ui.push({
    type: "model.output_delta",
    sessionId: "s-sub",
    payload: { delta: "internal", iteration: 1 },
  } as never);

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.entries[1]?.turn?.steps?.length, 0);
  assert.equal(snapshot.subagents[0]?.sessionId, "s-sub");
  store.dispose();
});
