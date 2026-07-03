import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenAICompatResponse, parseToolCallArgs } from "./openaiCompat";

test("parseToolCallArgs returns malformed:false for valid JSON", () => {
  const parsed = parseToolCallArgs('{"a":1}');
  assert.deepEqual(parsed.input, { a: 1 });
  assert.equal(parsed.malformed, false);
});

test("parseToolCallArgs flags malformed input and preserves raw", () => {
  const parsed = parseToolCallArgs("not json");
  assert.equal(parsed.malformed, true);
  assert.deepEqual(parsed.input, { raw: "not json" });
});

test("parseOpenAICompatResponse returns null when no message", () => {
  assert.equal(parseOpenAICompatResponse({ choices: [] }), null);
  assert.equal(parseOpenAICompatResponse({}), null);
});

test("parseOpenAICompatResponse extracts message + tool calls + usage", () => {
  const parsed = parseOpenAICompatResponse({
    choices: [
      {
        message: {
          content: "hello",
          tool_calls: [
            { function: { name: "t1", arguments: '{"x":1}' } },
            { function: { name: "t2", arguments: "not-json" } },
          ],
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 3 },
  });
  assert.ok(parsed);
  assert.equal(parsed?.assistantMessage, "hello");
  assert.equal(parsed?.toolCalls.length, 2);
  assert.equal(parsed?.toolCalls[0]?.malformedInput, undefined);
  assert.equal(parsed?.toolCalls[1]?.malformedInput, true);
  assert.deepEqual(parsed?.usage, { inputTokens: 5, outputTokens: 3 });
  assert.equal(parsed?.stop, true);
});

test("parseOpenAICompatResponse handles array-form content", () => {
  const parsed = parseOpenAICompatResponse({
    choices: [
      {
        message: {
          content: [
            { type: "text", text: "hello " },
            { type: "text", text: "world" },
          ],
        },
        finish_reason: "stop",
      },
    ],
  });
  assert.equal(parsed?.assistantMessage, "hello world");
});

test("parseOpenAICompatResponse captures reasoning parts separately", () => {
  const parsed = parseOpenAICompatResponse({
    choices: [
      {
        message: {
          content: [
            { type: "reasoning", text: "think " },
            { type: "text", text: "answer" },
          ],
        },
        finish_reason: "stop",
      },
    ],
  });
  assert.equal(parsed?.assistantMessage, "answer");
  assert.equal(parsed?.reasoningMessage, "think ");
});
