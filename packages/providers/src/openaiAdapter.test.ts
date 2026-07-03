import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "@micro-harness/core";
import { OpenAIAdapter } from "./openaiAdapter";

test("OpenAIAdapter posts to /chat/completions with Bearer auth", async () => {
  let seenUrl: string | undefined;
  let seenHeaders: Record<string, string> | undefined;
  let seenBody: unknown;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seenUrl = url;
    seenHeaders = init.headers as Record<string, string>;
    seenBody = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const adapter = new OpenAIAdapter({ fetchImpl });
  const result = await adapter.complete(
    { model: "gpt-x", messages: [{ role: "user", content: "hello" }] },
    { apiKey: "sk-test" },
  );
  assert.equal(seenUrl, "https://api.openai.com/v1/chat/completions");
  assert.match(seenHeaders?.authorization ?? "", /^Bearer sk-test$/);
  assert.equal((seenBody as { model: string }).model, "gpt-x");
  assert.equal(result.assistantMessage, "hi");
  assert.equal(result.stop, true);
});

test("OpenAIAdapter throws ProviderError on non-ok response", async () => {
  const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  const adapter = new OpenAIAdapter({ fetchImpl });
  await assert.rejects(
    () =>
      adapter.complete({ model: "m", messages: [{ role: "user", content: "x" }] }, { apiKey: "k" }),
    ProviderError,
  );
});

test("OpenAIAdapter uses custom baseUrl when provided", async () => {
  let seenUrl: string | undefined;
  const fetchImpl = (async (url: string) => {
    seenUrl = url;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const adapter = new OpenAIAdapter({ fetchImpl });
  await adapter.complete(
    { model: "m", messages: [] },
    { apiKey: "k", baseUrl: "https://example.test/v1" },
  );
  assert.equal(seenUrl, "https://example.test/v1/chat/completions");
});

test("OpenAIAdapter exposes defaultModel", () => {
  const adapter = new OpenAIAdapter({ defaultModel: "custom" });
  assert.equal(adapter.defaultModel, "custom");
});

test("OpenAIAdapter includes tools payload when provided", async () => {
  let seenBody: unknown;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    seenBody = JSON.parse(init.body as string);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const adapter = new OpenAIAdapter({ fetchImpl });
  await adapter.complete(
    {
      model: "gpt-x",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "time", description: "Returns time", inputSchema: { type: "object" } }],
    },
    { apiKey: "sk-test" },
  );

  assert.deepEqual((seenBody as { tools?: unknown[] }).tools, [
    {
      type: "function",
      function: {
        name: "time",
        description: "Returns time",
        parameters: { type: "object" },
      },
    },
  ]);
});

test("OpenAIAdapter streamComplete emits deltas and final response", async () => {
  const fetchImpl = (async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":[{"type":"reasoning","text":"think "},{"type":"text","text":"hel"}]}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;

  const adapter = new OpenAIAdapter({ fetchImpl });
  const events: Array<{ type: string; delta?: string; assistantMessage?: string }> = [];
  for await (const event of adapter.streamComplete!(
    { model: "gpt-x", messages: [{ role: "user", content: "hello" }] },
    { apiKey: "sk-test" },
  )) {
    if (event.type === "assistant.delta" || event.type === "reasoning.delta") {
      events.push({ type: event.type, delta: event.delta });
    } else {
      events.push({ type: event.type, assistantMessage: event.response.assistantMessage });
    }
  }

  assert.deepEqual(events, [
    { type: "reasoning.delta", delta: "think " },
    { type: "assistant.delta", delta: "hel" },
    { type: "assistant.delta", delta: "lo" },
    { type: "final", assistantMessage: "hello" },
  ]);
});
