import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "@micro-harnesses/core";
import { buildTranscript } from "./transcript";

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: overrides.id ?? "t1",
    iteration: overrides.iteration ?? 1,
    userMessage: overrides.userMessage ?? "",
    assistantMessage: overrides.assistantMessage ?? "",
    toolCalls: overrides.toolCalls ?? [],
    toolResults: overrides.toolResults ?? [],
  };
}

test("renders one line per turn with iteration, user, assistant, and tools", () => {
  const turns: Turn[] = [
    makeTurn({
      iteration: 1,
      userMessage: "fix the bug",
      assistantMessage: "looking into it",
      toolCalls: [{ name: "fs_read", input: {} }],
    }),
  ];
  const transcript = buildTranscript(turns, 1000);
  assert.equal(
    transcript,
    "iter=1 | user: fix the bug | assistant: looking into it tools=[fs_read]",
  );
});

test("omits empty user/assistant segments and tools when absent", () => {
  const turns: Turn[] = [makeTurn({ iteration: 2, userMessage: "", assistantMessage: "ok" })];
  const transcript = buildTranscript(turns, 1000);
  assert.equal(transcript, "iter=2 | assistant: ok");
});

test("joins multiple turns with newlines", () => {
  const turns: Turn[] = [
    makeTurn({ iteration: 1, userMessage: "a", assistantMessage: "1" }),
    makeTurn({ iteration: 2, userMessage: "b", assistantMessage: "2" }),
  ];
  const transcript = buildTranscript(turns, 1000);
  assert.equal(transcript.split("\n").length, 2);
});

test("truncates when the rendered transcript exceeds maxChars", () => {
  const turns: Turn[] = [
    makeTurn({ iteration: 1, userMessage: "a".repeat(500), assistantMessage: "b".repeat(500) }),
  ];
  const transcript = buildTranscript(turns, 50);
  assert.equal(transcript.length <= 50 + "\n...(truncated)".length, true);
  assert.ok(transcript.endsWith("...(truncated)"));
});
