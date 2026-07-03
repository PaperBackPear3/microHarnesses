import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { SessionStore } from "./sessionStore";

test("SessionStore persists manifest, events, and snapshots", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-"));
  const store = new SessionStore(stateDir);

  try {
    const manifest = await store.initSession(undefined, "ship feature");
    assert.equal(manifest.goal, "ship feature");

    await store.appendEvent(manifest.sessionId, {
      type: "run.started",
      timestamp: new Date().toISOString(),
      runId: "run-1",
      payload: {}
    });

    await store.saveSnapshot(manifest.sessionId, "run-1", {
      sessionId: manifest.sessionId,
      runId: "run-1",
      startedAt: new Date().toISOString(),
      turns: []
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
