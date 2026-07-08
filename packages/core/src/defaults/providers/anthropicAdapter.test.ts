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

test("listModels surfaces real context window from max_input_tokens", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            type: "model",
            id: "claude-sonnet-4-5",
            display_name: "Claude Sonnet 4.5",
            created_at: "2025-01-01T00:00:00Z",
            max_input_tokens: 200_000,
            max_tokens: 64_000,
            capabilities: null,
          },
        ],
        has_more: false,
        first_id: "claude-sonnet-4-5",
        last_id: "claude-sonnet-4-5",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const adapter = new AnthropicAdapter({ fetchImpl });
  const models = await adapter.listModels({ apiKey: "k" });
  assert.equal(models.length, 1);
  assert.equal(models[0]?.id, "claude-sonnet-4-5");
  assert.equal(models[0]?.label, "Claude Sonnet 4.5");
  assert.equal(models[0]?.contextWindowTokens, 200_000);
});

test("maps structured image/file content into Anthropic blocks", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return makeResponse("end_turn");
  };
  const adapter = new AnthropicAdapter({ fetchImpl });
  await adapter.complete(
    {
      model: "claude-test",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "review attached docs" },
            { type: "image", mimeType: "image/png", dataBase64: "iVBORw0KGgo=" },
            {
              type: "file",
              mimeType: "application/pdf",
              filename: "spec.pdf",
              dataBase64: "JVBERi0xLjQ=",
            },
          ],
        },
      ],
    },
    { apiKey: "k" },
  );

  const messages = capturedBody?.messages as Array<{ content: Array<Record<string, unknown>> }>;
  const parts = messages[0]?.content;
  assert.equal(parts[0]?.type, "text");
  assert.equal(parts[1]?.type, "image");
  assert.equal(parts[2]?.type, "document");
});
