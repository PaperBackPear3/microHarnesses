import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Turn } from "../runtime/state";
import { SessionStore } from "./sessionStore";

test("SessionStore persists manifest and snapshots", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-"));
  const store = new SessionStore(stateDir);

  try {
    const manifest = await store.initSession({ goal: "ship feature" });
    assert.equal(manifest.goal, "ship feature");

    await store.appendSupportHistory(manifest.sessionId, { runId: "run-1", note: "started" });

    await store.saveSnapshot(manifest.sessionId, "run-1", {
      sessionId: manifest.sessionId,
      runId: "run-1",
      startedAt: new Date().toISOString(),
      turns: [],
    });

    const sessions = await store.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.latestRunId, "run-1");

    const restored = await store.loadLatestSnapshot(manifest.sessionId);
    assert.equal(restored?.sessionId, manifest.sessionId);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("support history is persisted without adding manifest path metadata", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-history-"));
  const store = new SessionStore(stateDir);

  try {
    const manifest = await store.initSession({ goal: "track support history" });
    assert.equal("supportHistoryPath" in manifest, false);

    await store.appendSupportHistory(manifest.sessionId, { note: "first row" });
    const updated = await store.getSession(manifest.sessionId);
    assert.equal("supportHistoryPath" in updated, false);

    const historyPath = path.join(
      stateDir,
      "sessions",
      manifest.sessionId,
      "support-history.jsonl",
    );
    const historyFile = await stat(historyPath);
    assert.equal(historyFile.isFile(), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("getSessionIfExists returns undefined for unknown sessions", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-missing-"));
  const store = new SessionStore(stateDir);

  try {
    const manifest = await store.getSessionIfExists("missing-session");
    assert.equal(manifest, undefined);
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

test("saveSnapshot stores incremental turn deltas across snapshots", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-delta-"));
  const store = new SessionStore(stateDir);

  try {
    const manifest = await store.initSession({ goal: "delta snapshots" });

    const turnA = makeTurn("turn-a", "first", "answer-1");
    const turnB = makeTurn("turn-b", "second", "answer-2");
    await store.saveSnapshot(manifest.sessionId, "run-1", {
      sessionId: manifest.sessionId,
      runId: "run-1",
      startedAt: new Date().toISOString(),
      turns: [turnA, turnB],
    });

    const turnC = makeTurn("turn-c", "third", "answer-3");
    await store.saveSnapshot(manifest.sessionId, "run-1", {
      sessionId: manifest.sessionId,
      runId: "run-1",
      startedAt: new Date().toISOString(),
      turns: [turnA, turnB, turnC],
    });

    const snapshotsDir = path.join(stateDir, "sessions", manifest.sessionId, "snapshots");
    const files = (await readdir(snapshotsDir)).filter((name) => name.endsWith(".json"));
    assert.equal(files.length, 2);
    const snapshots = await Promise.all(
      files.map(async (file) => {
        const raw = await readFile(path.join(snapshotsDir, file), "utf8");
        return JSON.parse(raw) as {
          seq?: number;
          state?: { turns?: Array<{ id?: string }> };
        };
      }),
    );
    snapshots.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const latest = snapshots.at(-1);
    assert.ok(latest);
    assert.equal("turnsMode" in latest, false);
    assert.equal("baseTurnCount" in latest, false);
    assert.deepEqual(
      (latest.state?.turns ?? []).map((turn) => turn.id),
      ["turn-c"],
    );

    const restored = await store.loadLatestSnapshot(manifest.sessionId);
    assert.deepEqual(
      restored?.turns.map((turn) => turn.id),
      ["turn-a", "turn-b", "turn-c"],
    );
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("saveSnapshot skips no-op snapshots when no new turns were added", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-noop-"));
  const store = new SessionStore(stateDir);

  try {
    const manifest = await store.initSession({ goal: "avoid duplicate snapshots" });
    const turnA = makeTurn("turn-a", "first", "answer-1");
    const state = {
      sessionId: manifest.sessionId,
      runId: "run-1",
      startedAt: new Date().toISOString(),
      turns: [turnA],
    };
    const firstSnapshotId = await store.saveSnapshot(manifest.sessionId, "run-1", state);
    const secondSnapshotId = await store.saveSnapshot(manifest.sessionId, "run-2", {
      ...state,
      runId: "run-2",
    });

    const snapshotsDir = path.join(stateDir, "sessions", manifest.sessionId, "snapshots");
    const files = (await readdir(snapshotsDir)).filter((name) => name.endsWith(".json"));
    assert.equal(secondSnapshotId, firstSnapshotId);
    assert.equal(files.length, 1);

    const updated = await store.getSession(manifest.sessionId);
    assert.equal(updated.latestRunId, "run-2");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("saveInputAsset copies file into session input storage and can be resolved", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-session-store-assets-"));
  const store = new SessionStore(stateDir);
  try {
    const manifest = await store.initSession({ goal: "asset persistence" });
    const sourcePath = path.join(stateDir, "source-image.png");
    await writeFile(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const saved = await store.saveInputAsset(manifest.sessionId, sourcePath, {
      mimeType: "image/png",
    });
    const loaded = await store.getInputAsset(manifest.sessionId, saved.id);
    assert.ok(loaded);
    assert.equal(loaded?.mimeType, "image/png");
    assert.equal(loaded?.filename, "source-image.png");
    assert.equal(loaded?.source?.kind, "path");
    const loadedBytes = await readFile(loaded!.storagePath);
    assert.equal(loadedBytes.length, 4);
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
