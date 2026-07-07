import assert from "node:assert/strict";
import test from "node:test";
import type { RunState, Turn } from "../runtime/state";
import type { SubagentRunOptions } from "../subagents/types";
import { createAgenticCompressor } from "./agenticCompressor";

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: overrides.id ?? "t1",
    iteration: overrides.iteration ?? 1,
    userMessage: overrides.userMessage ?? "user said something",
    assistantMessage: overrides.assistantMessage ?? "assistant replied",
    toolCalls: overrides.toolCalls ?? [],
    toolResults: overrides.toolResults ?? [],
  };
}

function fakeState(): RunState {
  return { sessionId: "s", runId: "r", startedAt: "t", turns: [] };
}

test("spawns a summarizer and goal-finder subagent in parallel with no tools", async () => {
  const seenRequests: SubagentRunOptions[] = [];
  const compressor = createAgenticCompressor({
    async spawn(options) {
      seenRequests.push(options);
      if (options.promptName === "context-summarizer") {
        return {
          summary: "SUMMARY: did the thing.\nHIGHLIGHTS:\n- fact one\n- fact two",
          state: fakeState(),
        };
      }
      return {
        summary: "GOAL: refined goal text.\nSUBGOALS:\n- open question",
        state: fakeState(),
      };
    },
  });

  const result = await compressor([makeTurn()], { goal: "original goal" });

  assert.equal(seenRequests.length, 2);
  assert.ok(
    seenRequests.every(
      (request) => Array.isArray(request.allowedTools) && request.allowedTools.length === 0,
    ),
  );
  assert.ok(seenRequests.some((request) => request.promptName === "context-summarizer"));
  assert.ok(seenRequests.some((request) => request.promptName === "goal-finder"));

  assert.match(result.summary, /did the thing\./);
  assert.match(result.summary, /Refined goal: refined goal text\./);
  assert.deepEqual(result.highlights, ["fact one", "fact two", "goal: open question"]);
  assert.equal(result.refinedGoal, "refined goal text.");
  assert.deepEqual(result.supportHistory, []);
});

test("omits refinedGoal when the goal-finder restates the same goal", async () => {
  const compressor = createAgenticCompressor({
    async spawn(options) {
      if (options.promptName === "context-summarizer") {
        return { summary: "SUMMARY: fine.", state: fakeState() };
      }
      return { summary: "GOAL: same goal", state: fakeState() };
    },
  });
  const result = await compressor([makeTurn()], { goal: "same goal" });
  assert.equal(result.refinedGoal, undefined);
});

test("computes supportHistory deterministically from tool failures, not from the LLM", async () => {
  const compressor = createAgenticCompressor({
    async spawn(options) {
      if (options.promptName === "context-summarizer") {
        return { summary: "SUMMARY: ok.", state: fakeState() };
      }
      return { summary: "GOAL: g", state: fakeState() };
    },
  });
  const turns = [
    makeTurn({ iteration: 1, toolResults: [{ ok: false, output: {}, error: "boom" }] }),
  ];
  const result = await compressor(turns, { goal: "g" });
  assert.deepEqual(result.supportHistory, ["iter=1 tool-failure: boom"]);
});

test("falls back to the provided fallback compressor when spawning fails", async () => {
  let fallbackCalled = false;
  const compressor = createAgenticCompressor({
    async spawn() {
      throw new Error("no provider configured");
    },
    fallback: async (turns, context) => {
      fallbackCalled = true;
      return {
        summary: `fallback for ${turns.length} turns, goal=${context.goal}`,
        highlights: [],
        supportHistory: [],
      };
    },
  });
  const result = await compressor([makeTurn()], { goal: "g" });
  assert.equal(fallbackCalled, true);
  assert.equal(result.summary, "fallback for 1 turns, goal=g");
});

test("returns previous summary/highlights unchanged when there are no turns to compress", async () => {
  const compressor = createAgenticCompressor({
    async spawn() {
      throw new Error("must not be called");
    },
  });
  const result = await compressor([], {
    goal: "g",
    previousSummary: { summary: "prior", highlights: ["h1"], supportHistory: [] },
  });
  assert.equal(result.summary, "prior");
  assert.deepEqual(result.highlights, ["h1"]);
  assert.deepEqual(result.supportHistory, []);
});
