import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { CliConfig } from "../config/config.js";
import { buildComposition } from "./composition.js";

test("composition enables core auto-join for subagents by default", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-composition-"));
  try {
    const promptsDir = fileURLToPath(new URL("../../prompts", import.meta.url));
    const config: CliConfig = {
      stateDir,
      promptsDir,
      provider: "openai",
      effort: "medium",
      mode: "accept-edits",
      maxIterations: 8,
      snapshotEvery: 2,
      noSafety: true,
      privacyMode: true,
      compactionTriggerUtilization: 0.85,
      compactionTargetUtilization: 0.7,
      turnCompactionTargetRatio: 0.75,
      nonTurnTokenReserve: 1500,
    };

    const composition = await buildComposition(config, "s-test-autojoin");
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
