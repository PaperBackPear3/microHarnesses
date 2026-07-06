import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionRequest, ProviderStreamEvent } from "../../providers/types";
import { OllamaAdapter } from "./ollamaAdapter";

function makeRequest(): CompletionRequest {
  return {
    model: "llama3.2:3b",
    messages: [{ role: "user", content: "hello" }],
  };
}

test("streamComplete requests and returns Ollama token usage", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      [
        'data: {"choices":[{"delta":{"content":"hel"}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
        "",
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":5,"total_tokens":12}}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
      { status: 200 },
    );
  };

  const adapter = new OllamaAdapter({ fetchImpl });
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.streamComplete(makeRequest(), {
    apiKey: "ollama",
    baseUrl: "http://ollama.test/v1",
  })) {
    events.push(event);
  }

  assert.deepEqual(requestBody?.stream_options, { include_usage: true });
  const final = events[events.length - 1];
  assert.equal(final?.type, "final");
  if (final?.type !== "final") {
    assert.fail("expected a final stream event");
  }
  assert.equal(final.response.assistantMessage, "hello");
  assert.deepEqual(final.response.usage, { inputTokens: 7, outputTokens: 5 });
});
