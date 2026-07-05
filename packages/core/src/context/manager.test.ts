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
