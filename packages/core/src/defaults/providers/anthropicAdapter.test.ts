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

function makeResponse(stopReason: "max_tokens" | "end_turn") {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      model: "claude-test",
      stop_reason: stopReason,
      stop_sequence: null,
      container: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("complete keeps stop=false when stop_reason is max_tokens", async () => {
  const fetchImpl: typeof fetch = async () => makeResponse("max_tokens");

  const adapter = new AnthropicAdapter({ fetchImpl });
  const response = await adapter.complete(makeRequest(), { apiKey: "k" });
  assert.equal(response.stop, false);
});

test("complete keeps stop=true when stop_reason is end_turn", async () => {
  const fetchImpl: typeof fetch = async () => makeResponse("end_turn");

  const adapter = new AnthropicAdapter({ fetchImpl });
  const response = await adapter.complete(makeRequest(), { apiKey: "k" });
  assert.equal(response.stop, true);
});

test("complete maps tool_use blocks into tool calls", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "planning" },
          {
            type: "tool_use",
            id: "tool_1",
            name: "search",
            input: { query: "hello" },
            caller: { type: "direct" },
          },
        ],
        model: "claude-test",
        stop_reason: "tool_use",
        stop_sequence: null,
        container: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const adapter = new AnthropicAdapter({ fetchImpl });
  const response = await adapter.complete(makeRequest(), { apiKey: "k" });
  assert.equal(response.reasoningMessage, "planning");
  assert.deepEqual(response.toolCalls, [{ name: "search", input: { query: "hello" } }]);
  assert.equal(response.stop, false);
});
