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
    payload: { kind: "subagent", promptName: "coder", displayName: "goal-finder" },
  } as never);
  ui.push({
    type: "model.reasoning_delta",
    sessionId: "s-sub",
    payload: { delta: "thinking...", iteration: 1 },
  } as never);
  ui.push({
    type: "model.output_delta",
    sessionId: "s-sub",
    payload: { delta: "internal", iteration: 1 },
  } as never);
  ui.push({
    type: "tool.started",
    sessionId: "s-sub",
    payload: { action: "shell_exec", iteration: 1 },
  } as never);

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.entries[1]?.turn?.steps?.length, 0);
  assert.equal(snapshot.subagents[0]?.sessionId, "s-sub");
  assert.equal(snapshot.subagents[0]?.name, "goal-finder");
  assert.equal(snapshot.subagents[0]?.thinkingText, "thinking...");
  assert.equal(snapshot.subagents[0]?.outputText, "internal");
  assert.equal(snapshot.subagents[0]?.recentTools?.[0], "shell_exec started");
  store.dispose();
});

test("anchors spawned subagents to the current turn/iteration and does not emit late completion diag", () => {
  const ui = new UiStream();
  const approvals = new ApprovalController(process.cwd());
  const store = new ChatStore(ui, approvals, "2.0.0");
  store.startTurn("spawn");
  store.setActiveRunSession("s-root");

  ui.push({
    type: "tool.started",
    sessionId: "s-root",
    payload: { action: "spawn_subagent", iteration: 2, inputSummary: '{"goal":"reverse"}' },
  } as never);
  ui.push({
    type: "run.started",
    sessionId: "s-sub",
    payload: { kind: "subagent", promptName: "coder", displayName: "reverser" },
  } as never);
  ui.push({
    type: "run.completed",
    sessionId: "s-sub",
    payload: { summary: "done" },
  } as never);

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.subagents[0]?.anchorTurnId, snapshot.entries[1]?.turn?.id);
  assert.equal(snapshot.subagents[0]?.anchorIteration, 2);
  assert.equal(snapshot.subagents[0]?.status, "completed");
  const allSystemText = snapshot.entries
    .filter((entry) => entry.type === "system")
    .map((entry) => entry.text ?? "")
    .join("\n");
  assert(!allSystemText.includes("subagent completed (s-sub)"));
  store.dispose();
});
