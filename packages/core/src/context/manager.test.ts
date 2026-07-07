import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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

test("recordObservedUsage calibrates token estimates", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-calibrate-"));
  try {
    const manager = new ContextManager({
      stateDir,
      maxWorkingTurns: 6,
      tokenCounter: { count: (text) => text.length },
      contextWindowTokens: 1000,
    });
    await manager.init();
    const turns = [makeTurn(1, "hello", "world")];

    const before = await manager.buildWorkingTurns(turns);
    assert.equal(before.stats?.usedTokens, 10);
    manager.recordObservedUsage(before.recentTurns, 20);
    const after = await manager.buildWorkingTurns(turns);
    assert.equal((after.stats?.usedTokens ?? 0) > (before.stats?.usedTokens ?? 0), true);
    assert.equal(after.stats?.estimator.startsWith("calibrated:"), true);
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

test("buildWorkingTurns batches token-trigger compaction with hysteresis", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-token-overflow-"));
  try {
    let compressions = 0;
    const manager = new ContextManager({
      stateDir,
      maxWorkingTurns: 10,
      contextWindowTokens: 100,
      compressionTriggerUtilization: 0.7,
      compressionTargetUtilization: 0.4,
      tokenCounter: {
        count(text) {
          return text.length;
        },
      },
      compressor: () => {
        compressions += 1;
        return {
          summary: "",
          highlights: [],
          supportHistory: [],
        };
      },
    });
    await manager.init();
    const baseTurns = [
      makeTurn(1, "u".repeat(10), "a".repeat(10)),
      makeTurn(2, "u".repeat(10), "a".repeat(10)),
      makeTurn(3, "u".repeat(10), "a".repeat(10)),
      makeTurn(4, "u".repeat(10), "a".repeat(10)),
    ];

    const first = await manager.buildWorkingTurns(baseTurns);
    assert.equal(first.stats?.compressionTrigger, "tokens");
    assert.equal(first.stats?.overflowTurnsByTokenUsage, 1);
    assert.equal(first.stats?.overflowTurns, 2);
    assert.equal(first.recentTurns.length, 2);
    assert.equal(compressions, 1);

    const second = await manager.buildWorkingTurns([
      ...baseTurns,
      makeTurn(5, "u".repeat(10), "a".repeat(10)),
    ]);
    assert.equal(second.stats?.compressionTrigger, "tokens");
    assert.equal(second.stats?.overflowTurnsByTokenUsage, 2);
    assert.equal(second.stats?.compressed, false);
    assert.equal(compressions, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("buildWorkingTurns does not replace an explicit goal with refinedGoal", async () => {
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

    assert.deepEqual(seenGoals, ["original goal", "original goal"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("buildWorkingTurns adopts refinedGoal when no explicit goal is set", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-refined-goal-empty-"));
  try {
    const seenGoals: Array<string | undefined> = [];
    const manager = new ContextManager({
      stateDir,
      maxWorkingTurns: 1,
      goal: "",
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

    assert.deepEqual(seenGoals, ["", "refined goal"]);
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
    const turns = [makeTurn(1, "a", "1"), makeTurn(2, "b", "2")];
    const result = await manager.compactNow(turns);
    assert.equal(result.compressed, true);
    assert.equal(result.forced, true);
    assert.equal(result.deltaTurns, 1);
    const working = await manager.buildWorkingTurns(turns);
    assert.equal(working.recentTurns.length, 1);
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

test("compactNow forced mode is idempotent when no additional turns can be compacted", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-manual-idempotent-"));
  try {
    let calls = 0;
    const manager = new ContextManager({
      stateDir,
      maxWorkingTurns: 8,
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
    const turns = [makeTurn(1, "a", "1"), makeTurn(2, "b", "2")];
    const first = await manager.compactNow(turns);
    const second = await manager.compactNow(turns);
    assert.equal(first.compressed, true);
    assert.equal(first.deltaTurns, 1);
    assert.equal(second.compressed, false);
    assert.equal(second.deltaTurns, 0);
    assert.equal(calls, 1);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("init loads latest summary by file mtime, not filename order", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-ctx-summary-order-"));
  try {
    const summaryDir = path.join(stateDir, "summaries");
    await mkdir(summaryDir, { recursive: true });
    await writeFile(
      path.join(summaryDir, "summary-z.json"),
      JSON.stringify({ summary: "older", highlights: [], support_history: [] }),
      "utf8",
    );
    await writeFile(
      path.join(summaryDir, "summary-a.json"),
      JSON.stringify({ summary: "newer", highlights: [], support_history: [] }),
      "utf8",
    );
    const older = new Date("2025-01-01T00:00:00.000Z");
    const newer = new Date("2025-01-01T00:00:01.000Z");
    await utimes(path.join(summaryDir, "summary-z.json"), older, older);
    await utimes(path.join(summaryDir, "summary-a.json"), newer, newer);

    const manager = new ContextManager({ stateDir, maxWorkingTurns: 4 });
    await manager.init();
    const working = await manager.buildWorkingTurns([]);
    assert.equal(working.summary?.summary, "newer");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
