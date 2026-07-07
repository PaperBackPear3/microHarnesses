import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { CompressorFn, SubagentRunOptions, Turn } from "@micro-harnesses/core";
import type { CliConfig } from "../config/config.js";
import { buildComposition } from "./composition.js";

function makeConfig(stateDir: string): CliConfig {
  const promptsDir = fileURLToPath(new URL("../../prompts", import.meta.url));
  return {
    stateDir,
    promptsDir,
    provider: "openai",
    effort: "medium",
    mode: "accept-edits",
    maxIterations: 8,
    unlimitedIterations: false,
    snapshotEvery: 2,
    noSafety: true,
    privacyMode: true,
    compactionTriggerUtilization: 0.85,
    compactionTargetUtilization: 0.7,
    turnCompactionTargetRatio: 0.75,
    nonTurnTokenReserve: 1500,
  };
}

test("composition enables core auto-join for subagents by default", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-composition-"));
  try {
    const composition = await buildComposition(makeConfig(stateDir), "s-test-autojoin");
    const agent = composition.agent as unknown as {
      autoJoinSubagents?: boolean;
      subagents?: unknown;
    };
    assert.equal(agent.autoJoinSubagents, true);
    assert.ok(agent.subagents);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("composition configures core agentic compression through the subagent supervisor", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-composition-"));
  try {
    const composition = await buildComposition(makeConfig(stateDir), "s-test-agentic-compressor");
    const requests: SubagentRunOptions[] = [];
    const subagents = composition.subagents as typeof composition.subagents & {
      run(options: SubagentRunOptions): ReturnType<typeof composition.subagents.run>;
    };
    subagents.run = async (options) => {
      requests.push(options);
      return {
        summary:
          options.promptName === "context-summarizer"
            ? "SUMMARY: compressed.\nHIGHLIGHTS:\n- key fact"
            : "GOAL: refined goal",
        state: { sessionId: "s", runId: "r", startedAt: "t", turns: [] },
      };
    };

    const agent = composition.agent as unknown as { context: { compressor: CompressorFn } };
    const turn: Turn = {
      id: "t1",
      iteration: 1,
      userMessage: "original user request",
      assistantMessage: "assistant work",
      toolCalls: [],
      toolResults: [],
    };

    const result = await agent.context.compressor([turn], { goal: "original goal" });

    assert.equal(requests.length, 2);
    assert.ok(requests.some((request) => request.promptName === "context-summarizer"));
    assert.ok(requests.some((request) => request.promptName === "goal-finder"));
    assert.ok(requests.every((request) => request.allowedTools?.length === 0));
    assert.match(result.summary, /compressed/);
    assert.equal(result.refinedGoal, "refined goal");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("autopilot uses the configured iteration budget", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-composition-"));
  try {
    const config = { ...makeConfig(stateDir), mode: "autopilot" as const, maxIterations: 8 };
    const composition = await buildComposition(config, "s-test-autopilot-iterations");
    assert.equal(composition.runOptions().maxIterations, 8);
    assert.equal(composition.runOptions().unlimitedIterations, false);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("model route catalog aggregates across configured providers, not just the active one", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-composition-"));
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const composition = await buildComposition(makeConfig(stateDir), "s-test-route-catalog-1");
    const routes = composition.listModelRoutes();
    // Active provider (openai) keeps its static profile routes even without
    // credentials, matching prior single-provider fallback behavior.
    assert.ok(routes.some((r) => r.providerId === "openai"));
    // Ollama always resolves credentials (keyless local default) so it is
    // always included alongside the active provider.
    assert.ok(routes.some((r) => r.providerId === "ollama"));
    // Anthropic has no credentials configured and isn't the active provider,
    // so its models genuinely can't be invoked and are excluded.
    assert.ok(!routes.some((r) => r.providerId === "anthropic"));
  } finally {
    if (originalOpenAiKey !== undefined) process.env.OPENAI_API_KEY = originalOpenAiKey;
    if (originalAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("model route catalog includes a non-active provider once its credentials are configured", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-composition-"));
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    const composition = await buildComposition(makeConfig(stateDir), "s-test-route-catalog-2");
    const routes = composition.listModelRoutes();
    const anthropicRoutes = routes.filter((r) => r.providerId === "anthropic");
    assert.ok(anthropicRoutes.length > 0);
    // Known Anthropic models get real cost/context metadata from the
    // maintained catalog rather than the coarse tier heuristic.
    assert.ok(anthropicRoutes.some((r) => r.metadata?.costSource === "catalog"));
  } finally {
    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
    await rm(stateDir, { recursive: true, force: true });
  }
});
