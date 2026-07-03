import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "@micro-harness/core";
import { AnthropicAdapter } from "./anthropicAdapter";

test("AnthropicAdapter includes tools payload when provided", async () => {
  let seenBody: unknown;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seenBody = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const adapter = new AnthropicAdapter({ fetchImpl });
  await adapter.complete(
    {
      model: "claude-x",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "time", description: "Returns time", inputSchema: { type: "object" } }],
    },
    { apiKey: "sk-ant-test" },
  );

  assert.deepEqual((seenBody as { tools?: unknown[] }).tools, [
    {
      name: "time",
      description: "Returns time",
      input_schema: { type: "object" },
    },
  ]);
});

test("AnthropicAdapter throws ProviderError on non-ok response", async () => {
  const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  const adapter = new AnthropicAdapter({ fetchImpl });
  await assert.rejects(
    () =>
      adapter.complete(
        { model: "m", messages: [{ role: "user", content: "x" }] },
        { apiKey: "k", baseUrl: "https://api.anthropic.com/v1" },
      ),
    ProviderError,
  );
});

test("AnthropicAdapter streamComplete emits deltas and final response", async () => {
  const fetchImpl = (async () => {
    const sse = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}',
      "",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"plan "}}',
      "",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"first"}}',
      "",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      "",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello "}}',
      "",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}',
      "",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
      "",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;

  const adapter = new AnthropicAdapter({ fetchImpl });
  const events: Array<{ type: string; delta?: string; assistantMessage?: string }> = [];
  for await (const event of adapter.streamComplete!(
    { model: "m", messages: [{ role: "user", content: "x" }] },
    { apiKey: "k" },
  )) {
    if (event.type === "assistant.delta" || event.type === "reasoning.delta") {
      events.push({ type: event.type, delta: event.delta });
    } else {
      events.push({ type: event.type, assistantMessage: event.response.assistantMessage });
    }
  }

  assert.deepEqual(events, [
    { type: "reasoning.delta", delta: "plan " },
    { type: "reasoning.delta", delta: "first" },
    { type: "assistant.delta", delta: "hello " },
    { type: "assistant.delta", delta: "world" },
    { type: "final", assistantMessage: "hello world" },
  ]);
});
