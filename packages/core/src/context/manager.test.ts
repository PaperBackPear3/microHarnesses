import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Turn } from "../runtime/state";
import { ContextManager } from "./manager";

function makeTurn(i: number, user: string, assistant: string): Turn {
  return {
    id: `turn-${i}`,
    iteration: i,
    userMessage: user,
    assistantMessage: assistant,
    toolCalls: [],
    toolResults: [],
  };
}

test("buildWorkingTurns reports context-window utilization stats", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-"));
  try {
    const manager = new ContextManager({
      stateDir,
      maxWorkingTurns: 6,
      contextWindowTokens: 1000,
    });
    await manager.init();
    const turns = [makeTurn(1, "hello there", "general answer text")];
    const working = await manager.buildWorkingTurns(turns);
    assert.ok(working.stats);
    assert.equal(working.stats?.totalTurns, 1);
    assert.equal(working.stats?.workingTurns, 1);
    assert.equal(working.stats?.overflowTurns, 0);
    assert.equal(working.stats?.maxTokens, 1000);
    assert.equal(working.stats?.usedTokens > 0, true);
    assert.equal(working.stats!.utilization > 0 && working.stats!.utilization <= 1, true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("buildWorkingTurns reports overflow and compression once turns exceed the window", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-overflow-"));
  try {
    const manager = new ContextManager({ stateDir, maxWorkingTurns: 2 });
    await manager.init();
    const turns = [
      makeTurn(1, "a", "1"),
      makeTurn(2, "b", "2"),
      makeTurn(3, "c", "3"),
      makeTurn(4, "d", "4"),
    ];
    const working = await manager.buildWorkingTurns(turns);
    assert.equal(working.stats?.totalTurns, 4);
    assert.equal(working.stats?.workingTurns, 2);
    assert.equal(working.stats?.overflowTurns, 2);
    assert.equal(working.stats?.compressed, true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("buildWorkingTurns adopts a compressor's refinedGoal for later compression cycles", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-refined-goal-"));
  try {
    const seenGoals: Array<string | undefined> = [];
    const manager = new ContextManager({
      stateDir,
      maxWorkingTurns: 1,
      goal: "original goal",
      compressor: (turns, context) => {
        seenGoals.push(context.goal);
        return {
          summary: `compressed ${turns.length} turns`,
          highlights: [],
          supportHistory: [],
          refinedGoal: "refined goal",
        };
      },
    });
    await manager.init();

    await manager.buildWorkingTurns([makeTurn(1, "a", "1"), makeTurn(2, "b", "2")]);
    await manager.buildWorkingTurns([
      makeTurn(1, "a", "1"),
      makeTurn(2, "b", "2"),
      makeTurn(3, "c", "3"),
    ]);

    assert.deepEqual(seenGoals, ["original goal", "refined goal"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("buildWorkingTurns invokes compression lifecycle hooks for new overflow deltas", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-hooks-"));
  try {
    const manager = new ContextManager({ stateDir, maxWorkingTurns: 1 });
    await manager.init();
    const turns = [makeTurn(1, "a", "1"), makeTurn(2, "b", "2"), makeTurn(3, "c", "3")];
    let started = 0;
    let completed = 0;
    await manager.buildWorkingTurns(turns, {
      onCompressionStarted(details) {
        started = details.deltaTurns;
      },
      onCompressionCompleted(details) {
        completed = details.deltaTurns;
      },
    });
    assert.equal(started, 2);
    assert.equal(completed, 2);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("compactNow forces compression even when turns do not overflow the window", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-manual-"));
  try {
    let calls = 0;
    const manager = new ContextManager({
      stateDir,
      maxWorkingTurns: 10,
      compressor: (turns) => {
        calls += 1;
        return {
          summary: `forced ${turns.length}`,
          highlights: [],
          supportHistory: [],
        };
      },
    });
    await manager.init();
    const result = await manager.compactNow([makeTurn(1, "a", "1"), makeTurn(2, "b", "2")]);
    assert.equal(result.compressed, true);
    assert.equal(result.forced, true);
    assert.equal(result.deltaTurns, 2);
    assert.equal(calls, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("compactNow uses overflow mode when there are uncompressed overflow turns", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-manual-overflow-"));
  try {
    const manager = new ContextManager({
      stateDir,
      maxWorkingTurns: 2,
      compressor: (turns) => ({
        summary: `overflow ${turns.length}`,
        highlights: [],
        supportHistory: [],
      }),
    });
    await manager.init();
    const result = await manager.compactNow([
      makeTurn(1, "a", "1"),
      makeTurn(2, "b", "2"),
      makeTurn(3, "c", "3"),
      makeTurn(4, "d", "4"),
    ]);
    assert.equal(result.compressed, true);
    assert.equal(result.forced, false);
    assert.equal(result.overflowTurns, 2);
    assert.equal(result.deltaTurns, 2);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
