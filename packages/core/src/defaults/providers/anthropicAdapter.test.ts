import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionRequest } from "../../providers/types";
import { AnthropicAdapter } from "./anthropicAdapter";

function makeRequest(): CompletionRequest {
  return {
    model: "claude-test",
    messages: [{ role: "user", content: "hello" }],
  };
}

test("complete keeps stop=false when stop_reason is max_tokens", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        content: [{ type: "text", text: "partial" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      { status: 200 },
    );

  const adapter = new AnthropicAdapter({ fetchImpl });
  const response = await adapter.complete(makeRequest(), { apiKey: "k" });
  assert.equal(response.stop, false);
});

test("complete keeps stop=true when stop_reason is end_turn", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        content: [{ type: "text", text: "done" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      { status: 200 },
    );

  const adapter = new AnthropicAdapter({ fetchImpl });
  const response = await adapter.complete(makeRequest(), { apiKey: "k" });
  assert.equal(response.stop, true);
});
