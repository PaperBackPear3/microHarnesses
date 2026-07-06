import assert from "node:assert/strict";
import test from "node:test";
import type { CompressorFn, PluginApi, SubagentRunOptions } from "@micro-harnesses/core";
import { AgenticCompressionPlugin } from "./agenticCompressionPlugin";

function makeApi(
  spawn: (options: SubagentRunOptions) => Promise<{ summary: string; state: never }>,
): {
  api: PluginApi;
  getCompressor(): CompressorFn | undefined;
} {
  let compressor: CompressorFn | undefined;
  const api: PluginApi = {
    registerTool() {},
    registerChannel() {},
    registerSkill() {},
    onBeforeLoop() {},
    onAfterLoop() {},
    setCompressor(fn) {
      compressor = fn;
    },
    registerProvider() {},
    registerCredentialsResolver() {},
    registerPolicyRule() {},
    setModelSelector() {},
    observability: {
      get tracer(): never {
        throw new Error("observability not available in tests");
      },
      get meter(): never {
        throw new Error("observability not available in tests");
      },
      get logger(): never {
        throw new Error("observability not available in tests");
      },
      registerTraceExporter() {},
      registerMetricExporter() {},
      registerLogExporter() {},
    },
    agents: {
      spawn: spawn as PluginApi["agents"]["spawn"],
      async invoke() {
        throw new Error("invoke not used in these tests");
      },
    },
  };
  return { api, getCompressor: () => compressor };
}

test("register() calls api.setCompressor with a working CompressorFn", async () => {
  const { api, getCompressor } = makeApi(async (options) => ({
    summary:
      options.promptName === "context-summarizer"
        ? "SUMMARY: done.\nHIGHLIGHTS:\n- one"
        : "GOAL: refined",
    state: undefined as never,
  }));

  new AgenticCompressionPlugin().register(api);
  const compressor = getCompressor();
  assert.ok(compressor, "setCompressor must be called during register()");

  const result = await compressor!(
    [
      {
        id: "t1",
        iteration: 1,
        userMessage: "u",
        assistantMessage: "a",
        toolCalls: [],
        toolResults: [],
      },
    ],
    { goal: "original" },
  );
  assert.match(result.summary, /done\./);
  assert.equal(result.refinedGoal, "refined");
});

test("register() routes spawn requests through api.agents.spawn", async () => {
  let spawnCalls = 0;
  const { api, getCompressor } = makeApi(async (options) => {
    spawnCalls += 1;
    return {
      summary: options.promptName === "context-summarizer" ? "SUMMARY: x" : "GOAL: y",
      state: undefined as never,
    };
  });

  new AgenticCompressionPlugin({ summarizerPromptName: "custom-summarizer" }).register(api);
  const compressor = getCompressor();
  await compressor!(
    [
      {
        id: "t1",
        iteration: 1,
        userMessage: "u",
        assistantMessage: "a",
        toolCalls: [],
        toolResults: [],
      },
    ],
    { goal: "g" },
  );
  assert.equal(spawnCalls, 2);
});
