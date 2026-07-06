import assert from "node:assert/strict";
import test from "node:test";
import {
  detectOllamaContextWindowTokens,
  normalizeOllamaBaseUrl,
  parseOllamaContextWindow,
} from "./contextWindow";

test("normalizeOllamaBaseUrl strips trailing /v1 and slash", () => {
  assert.equal(normalizeOllamaBaseUrl("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaBaseUrl("http://127.0.0.1:11434/v1/"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaBaseUrl("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
});

test("parseOllamaContextWindow reads model_info context_length keys", () => {
  const parsed = parseOllamaContextWindow({
    model_info: {
      "gemma2.context_length": 8192,
    },
  });
  assert.equal(parsed, 8192);
});

test("parseOllamaContextWindow falls back to num_ctx in parameters", () => {
  const parsed = parseOllamaContextWindow({
    parameters: "temperature 0.7\nnum_ctx 32768\nrepeat_penalty 1.1",
  });
  assert.equal(parsed, 32768);
});

test("detectOllamaContextWindowTokens returns parsed value from /api/show", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        model_info: { "llama.context_length": 4096 },
      }),
      { status: 200 },
    );

  const detected = await detectOllamaContextWindowTokens({
    baseUrl: "http://ollama.test/v1",
    model: "llama3.1:8b",
    fetchImpl,
  });
  assert.equal(detected, 4096);
});

test("detectOllamaContextWindowTokens returns undefined on HTTP error", async () => {
  const fetchImpl: typeof fetch = async () => new Response("boom", { status: 500 });
  const detected = await detectOllamaContextWindowTokens({
    baseUrl: "http://ollama.test/v1",
    model: "llama3.1:8b",
    fetchImpl,
  });
  assert.equal(detected, undefined);
});
