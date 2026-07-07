import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ChatEntry,
  appendAssistantDelta,
  appendStepSystemMessage,
  appendThinkingDelta,
  startUserTurn,
  toggleAllThinkingCollapse,
} from "./transcript.js";

test("keeps multi-iteration thinking and assistant output in step order", () => {
  let entries: ChatEntry[] = startUserTurn([], "turn-1", "solve this");
  let activeTurnId: string | undefined = "turn-1";
  const ids = idFactory();

  ({ entries, activeTurnId } = appendThinkingDelta(entries, activeTurnId, 1, ids, "thinking 1"));
  ({ entries, activeTurnId } = appendAssistantDelta(entries, activeTurnId, 1, ids, "assistant 1"));
  entries = appendStepSystemMessage(entries, activeTurnId, 1, ids, "tool started: read");
  ({ entries, activeTurnId } = appendThinkingDelta(entries, activeTurnId, 2, ids, "thinking 2"));
  ({ entries } = appendAssistantDelta(entries, activeTurnId, 2, ids, "assistant 2"));

  const steps = entries[0]?.turn?.steps;
  assert.equal(steps?.length, 2);
  assert.equal(steps?.[0]?.thinkingText, "thinking 1");
  assert.equal(steps?.[0]?.assistantText, "assistant 1");
  assert.deepEqual(
    steps?.[0]?.systemMessages.map((message) => message.text),
    ["tool started: read"],
  );
  assert.equal(steps?.[1]?.thinkingText, "thinking 2");
  assert.equal(steps?.[1]?.assistantText, "assistant 2");
});

test("keeps a reasoning-only iteration before later tool-driven iterations", () => {
  let entries: ChatEntry[] = startUserTurn([], "turn-1", "inspect then answer");
  let activeTurnId: string | undefined = "turn-1";
  const ids = idFactory();

  ({ entries, activeTurnId } = appendThinkingDelta(entries, activeTurnId, 1, ids, "need a tool"));
  entries = appendStepSystemMessage(entries, activeTurnId, 1, ids, "tool started: inspect");
  ({ entries } = appendAssistantDelta(entries, activeTurnId, 2, ids, "final answer"));

  const steps = entries[0]?.turn?.steps;
  assert.equal(steps?.length, 2);
  assert.equal(steps?.[0]?.thinkingText, "need a tool");
  assert.deepEqual(
    steps?.[0]?.systemMessages.map((message) => message.text),
    ["tool started: inspect"],
  );
  assert.equal(steps?.[1]?.assistantText, "final answer");
});

function idFactory(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `step-${next}`;
  };
}

test("toggles collapse state for all reasoning steps", () => {
  let entries: ChatEntry[] = startUserTurn([], "turn-1", "inspect");
  let activeTurnId: string | undefined = "turn-1";
  const ids = idFactory();

  ({ entries, activeTurnId } = appendThinkingDelta(entries, activeTurnId, 1, ids, "first"));
  ({ entries, activeTurnId } = appendThinkingDelta(entries, activeTurnId, 2, ids, "second"));
  entries = startUserTurn(entries, "turn-2", "follow up");
  activeTurnId = "turn-2";
  ({ entries } = appendThinkingDelta(entries, activeTurnId, 1, ids, "third"));

  const collapsed = toggleAllThinkingCollapse(entries);
  const collapsedFlags = collapsed
    .flatMap((entry) => entry.turn?.steps ?? [])
    .filter((step) => step.thinkingText.length > 0)
    .map((step) => step.thinkingCollapsed);
  assert.deepEqual(collapsedFlags, [true, true, true]);

  const expanded = toggleAllThinkingCollapse(collapsed);
  const expandedFlags = expanded
    .flatMap((entry) => entry.turn?.steps ?? [])
    .filter((step) => step.thinkingText.length > 0)
    .map((step) => step.thinkingCollapsed);
  assert.deepEqual(expandedFlags, [false, false, false]);
});
