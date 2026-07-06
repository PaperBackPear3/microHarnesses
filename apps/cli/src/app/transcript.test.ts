import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ChatEntry,
  appendAssistantDelta,
  appendStepSystemMessage,
  appendThinkingDelta,
  startUserTurn,
} from "./transcript";

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
