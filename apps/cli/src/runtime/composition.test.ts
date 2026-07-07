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
