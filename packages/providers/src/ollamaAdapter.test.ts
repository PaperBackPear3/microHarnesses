import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "@micro-harness/core";
import { OllamaAdapter } from "./ollamaAdapter";

test("OllamaAdapter includes tools payload and folds developer role into system", async () => {
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

  const adapter = new OllamaAdapter({ fetchImpl });
  await adapter.complete(
    {
      model: "gemma4:e4b",
      messages: [
        { role: "developer", content: "dev" },
        { role: "user", content: "hi" },
      ],
      tools: [{ name: "time", description: "Returns time", inputSchema: { type: "object" } }],
    },
    { apiKey: "ollama" },
  );

  assert.deepEqual((seenBody as { messages: Array<{ role: string }> }).messages[0], {
    role: "system",
    content: "dev",
  });
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

test("OllamaAdapter throws ProviderError on non-ok response", async () => {
  const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  const adapter = new OllamaAdapter({ fetchImpl });
  await assert.rejects(
    () =>
      adapter.complete(
        { model: "m", messages: [{ role: "user", content: "x" }] },
        { apiKey: "k", baseUrl: "http://127.0.0.1:11434/v1" },
      ),
    ProviderError,
  );
});
