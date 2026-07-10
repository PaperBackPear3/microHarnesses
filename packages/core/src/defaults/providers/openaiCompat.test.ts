import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOpenAICompatStreamChunk,
  createOpenAICompatStreamState,
  finalizeOpenAICompatStream,
  parseOpenAICompatResponse,
} from "./openaiCompat";

test("parseOpenAICompatResponse maps Ollama token usage fields", () => {
  const parsed = parseOpenAICompatResponse({
    choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
    prompt_eval_count: 11,
    eval_count: 7,
  });

  assert.deepEqual(parsed?.usage, { inputTokens: 11, outputTokens: 7 });
});

test("stream state maps Ollama token usage fields", () => {
  const state = createOpenAICompatStreamState();
  applyOpenAICompatStreamChunk(state, {
    choices: [{ delta: { content: "hello" }, finish_reason: "stop" }],
    usage: {
      prompt_eval_count: 13,
      eval_count: 5,
    },
  });

  assert.deepEqual(finalizeOpenAICompatStream(state).usage, {
    inputTokens: 13,
    outputTokens: 5,
  });
});

test("parseOpenAICompatResponse extracts tagged function calls when tool_calls are missing", () => {
  const parsed = parseOpenAICompatResponse({
    choices: [
      {
        message: {
          content: [
            { type: "text", text: "I'll check that now." },
            {
              type: "text",
              text: "\n<tool_call><function=explore_agent><parameter=query>foo</parameter><parameter=root_path>/tmp</parameter></function></tool_call>",
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  });

  assert.equal(parsed?.assistantMessage, "I'll check that now.");
  assert.deepEqual(parsed?.toolCalls, [
    { name: "explore_agent", input: { query: "foo", root_path: "/tmp" } },
  ]);
  assert.equal(parsed?.stop, false);
});

test("finalizeOpenAICompatStream extracts tagged function calls when structured calls are absent", () => {
  const state = createOpenAICompatStreamState();
  applyOpenAICompatStreamChunk(state, {
    choices: [
      {
        delta: {
          content:
            "Thinking...\n<function=time><parameter=timezone>UTC</parameter></function>",
        },
        finish_reason: "tool_calls",
      },
    ],
  });

  const final = finalizeOpenAICompatStream(state);
  assert.equal(final.assistantMessage, "Thinking...");
  assert.deepEqual(final.toolCalls, [{ name: "time", input: { timezone: "UTC" } }]);
  assert.equal(final.stop, false);
});
