import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionRequest, ProviderStreamEvent } from "../../providers/types";
import { ProviderError } from "../../shared/errors";
import { finishReasonIndicatesStop } from "./openaiCompat";
import { OpenAICompatAdapter } from "./openaiCompatAdapter";

function makeRequest(): CompletionRequest {
  return {
    model: "test-model",
    messages: [
      { role: "developer", content: "instructions" },
      { role: "user", content: "hello" },
    ],
  };
}

function makeAdapter(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new OpenAICompatAdapter({
    providerId: "compat-test",
    defaultModel: "test-model",
    defaultBaseUrl: "http://compat.test/v1",
    fetchImpl,
    ...overrides,
  });
}

test("sends bearer auth, extra headers, and maps developer role by default", async () => {
  let capturedHeaders: Record<string, string> | undefined;
  let capturedBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    capturedHeaders = init?.headers as Record<string, string>;
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }),
      { status: 200 },
    );
  };

  const adapter = makeAdapter(fetchImpl, { extraHeaders: { "x-title": "test" } });
  const response = await adapter.complete(makeRequest(), { apiKey: "sk-test" });

  assert.equal(capturedHeaders?.authorization, "Bearer sk-test");
  assert.equal(capturedHeaders?.["x-title"], "test");
  const roles = (capturedBody?.messages as Array<{ role: string }>).map((m) => m.role);
  assert.deepEqual(roles, ["system", "user"]);
  assert.equal(response.assistantMessage, "hi");
  assert.equal(response.stop, true);
});

test("authStyle none omits the authorization header", async () => {
  let capturedHeaders: Record<string, string> | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    capturedHeaders = init?.headers as Record<string, string>;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
      { status: 200 },
    );
  };

  const adapter = makeAdapter(fetchImpl, { authStyle: "none" });
  await adapter.complete(makeRequest(), { apiKey: "unused" });
  assert.equal(capturedHeaders?.authorization, undefined);
});

test("throws ProviderError when no base URL is available", async () => {
  const adapter = new OpenAICompatAdapter({
    providerId: "compat-test",
    defaultModel: "test-model",
    fetchImpl: async () => new Response("{}", { status: 200 }),
  });
  await assert.rejects(
    adapter.complete(makeRequest(), { apiKey: "sk-test" }),
    (error: unknown) => error instanceof ProviderError,
  );
});

test("throws ProviderError on malformed stream frames", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(["data: {not json", "", "data: [DONE]", ""].join("\n"), { status: 200 });

  const adapter = makeAdapter(fetchImpl);
  await assert.rejects(
    (async () => {
      const events: ProviderStreamEvent[] = [];
      for await (const event of adapter.streamComplete(makeRequest(), { apiKey: "k" })) {
        events.push(event);
      }
    })(),
    (error: unknown) =>
      error instanceof ProviderError && error.message.includes("malformed stream frame"),
  );
});

test("finishReasonIndicatesStop maps terminal and continuing reasons", () => {
  assert.equal(finishReasonIndicatesStop("stop"), true);
  assert.equal(finishReasonIndicatesStop("length"), true);
  assert.equal(finishReasonIndicatesStop("content_filter"), true);
  assert.equal(finishReasonIndicatesStop("tool_calls"), false);
  assert.equal(finishReasonIndicatesStop(undefined), false);
});

test("stream marks stop on length finish reason", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      [
        'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
      { status: 200 },
    );

  const adapter = makeAdapter(fetchImpl);
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.streamComplete(makeRequest(), { apiKey: "k" })) {
    events.push(event);
  }
  const final = events[events.length - 1];
  assert.equal(final?.type, "final");
  if (final?.type === "final") {
    assert.equal(final.response.stop, true);
  }
});
