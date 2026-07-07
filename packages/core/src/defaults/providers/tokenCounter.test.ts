import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAICompatibleTokenCounter } from "./tokenCounter";

test("createOpenAICompatibleTokenCounter uses tiktoken for OpenAI-family models", async () => {
  const created = await createOpenAICompatibleTokenCounter("gpt-4o-mini");
  assert.equal(created.estimator.startsWith("tiktoken:"), true);
  assert.equal(created.counter.count("hello world") > 0, true);
});

test("createOpenAICompatibleTokenCounter falls back to heuristic for unknown models", async () => {
  const created = await createOpenAICompatibleTokenCounter("definitely-unknown-model");
  assert.equal(created.estimator, "heuristic");
  assert.equal(created.counter.count("hello world") > 0, true);
});
