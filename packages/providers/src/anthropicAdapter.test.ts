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
