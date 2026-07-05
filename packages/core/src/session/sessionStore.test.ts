import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Turn } from "../context/types";
import { SessionStore } from "./sessionStore";

test("SessionStore persists manifest, events, and snapshots", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-"));
  const store = new SessionStore(stateDir);

  try {
    const manifest = await store.initSession({ goal: "ship feature" });
    assert.equal(manifest.goal, "ship feature");

    await store.appendEvent(manifest.sessionId, {
      type: "run.started",
      timestamp: new Date().toISOString(),
      runId: "run-1",
      payload: {},
    });

    await store.saveSnapshot(manifest.sessionId, "run-1", {
      sessionId: manifest.sessionId,
      runId: "run-1",
      startedAt: new Date().toISOString(),
      turns: [],
    });

    const sessions = await store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.lastEventSeq, 1);

    const restored = await store.loadLatestSnapshot(manifest.sessionId);
    assert.equal(restored?.sessionId, manifest.sessionId);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("loadLatestSnapshot reconstructs turns across snapshot resets", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-merge-"));
  const store = new SessionStore(stateDir);

  try {
    const manifest = await store.initSession({ goal: "resume history" });

    const turnA = makeTurn("turn-a", "first", "answer-1");
    const turnB = makeTurn("turn-b", "second", "answer-2");
    await store.saveSnapshot(manifest.sessionId, "run-1", {
      sessionId: manifest.sessionId,
      runId: "run-1",
      startedAt: new Date().toISOString(),
      turns: [turnA, turnB],
    });

    const turnC = makeTurn("turn-c", "third", "answer-3");
    await store.saveSnapshot(manifest.sessionId, "run-2", {
      sessionId: manifest.sessionId,
      runId: "run-2",
      startedAt: new Date().toISOString(),
      turns: [turnC],
    });

    const restored = await store.loadLatestSnapshot(manifest.sessionId);
    assert.ok(restored);
    assert.deepEqual(
      restored?.turns.map((turn) => turn.id),
      ["turn-a", "turn-b", "turn-c"],
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

function makeTurn(id: string, userMessage: string, assistantMessage: string): Turn {
  return {
    id,
    iteration: 1,
    userMessage,
    assistantMessage,
    toolCalls: [],
    toolResults: [],
  };
}
