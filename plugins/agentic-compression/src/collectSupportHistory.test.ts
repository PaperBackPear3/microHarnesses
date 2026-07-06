import assert from "node:assert/strict";
import test from "node:test";
import type { Turn } from "@micro-harnesses/core";
import { collectSupportHistory } from "./collectSupportHistory";

function makeTurn(iteration: number, toolResults: Turn["toolResults"]): Turn {
  return {
    id: `t${iteration}`,
    iteration,
    userMessage: "",
    assistantMessage: "",
    toolCalls: [],
    toolResults,
  };
}

test("extracts only failed tool results, formatted with iteration and error", () => {
  const turns: Turn[] = [
    makeTurn(1, [
      { ok: true, output: {} },
      { ok: false, output: {}, error: "boom" },
    ]),
    makeTurn(2, [{ ok: true, output: {} }]),
  ];
  const history = collectSupportHistory(turns);
  assert.deepEqual(history, ["iter=1 tool-failure: boom"]);
});

test("falls back to 'unknown error' when a failed result has no error message", () => {
  const turns: Turn[] = [makeTurn(1, [{ ok: false, output: {} }])];
  const history = collectSupportHistory(turns);
  assert.deepEqual(history, ["iter=1 tool-failure: unknown error"]);
});

test("returns an empty array when there are no failures", () => {
  const turns: Turn[] = [makeTurn(1, [{ ok: true, output: {} }])];
  assert.deepEqual(collectSupportHistory(turns), []);
});
