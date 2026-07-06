import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOpenAICompatStreamChunk,
  createOpenAICompatStreamState,
  finalizeOpenAICompatStream,
  parseOpenAICompatResponse,
} from "./openaiCompat";

test("parseOpenAICompatResponse maps Ollama token usage fields", () => {
  const parsed = parseOpenAICompatResponse({
    choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
    prompt_eval_count: 11,
    eval_count: 7,
  });

  assert.deepEqual(parsed?.usage, { inputTokens: 11, outputTokens: 7 });
});

test("stream state maps Ollama token usage fields", () => {
  const state = createOpenAICompatStreamState();
  applyOpenAICompatStreamChunk(state, {
    choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
    usage: {
      prompt_eval_count: 13,
      eval_count: 5,
    },
  });

  assert.deepEqual(finalizeOpenAICompatStream(state).usage, {
    inputTokens: 13,
    outputTokens: 5,
  });
});
