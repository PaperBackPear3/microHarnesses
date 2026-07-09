import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqliteTodoStore } from "./sqliteTodoStore";

test("SqliteTodoStore enforces hard lock owner on mutation", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-sqlite-todos-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    const todo = await store.create({ text: "Implement planner" });
    await store.lock(todo.id, "owner-a");
    await assert.rejects(() => store.update(todo.id, { text: "nope" }, "owner-b"));
    const updated = await store.update(todo.id, { status: "in_progress" }, "owner-a");
    assert.equal(updated.status, "in_progress");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("SqliteTodoStore nextReady respects dependencies", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-sqlite-todos-ready-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    const base = await store.create({ id: "base", text: "Base" });
    const next = await store.create({ id: "next", text: "Next" });
    await store.addDependency(next.id, base.id);
    const before = await store.nextReady();
    assert.equal(
      before.some((todo) => todo.id === "next"),
      false,
    );
    await store.update(base.id, { status: "done" }, "runner");
    const after = await store.nextReady();
    assert.equal(
      after.some((todo) => todo.id === "next"),
      true,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("SqliteTodoStore filters todos by scope", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-sqlite-todos-scope-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    await store.create({ id: "a", text: "A", scopeId: "session-a" });
    await store.create({ id: "b", text: "B", scopeId: "session-b" });
    await store.create({ id: "legacy", text: "Legacy" });

    const scoped = await store.list({ scopeId: "session-a" });
    assert.deepEqual(
      scoped.map((todo) => todo.id),
      ["a"],
    );
    assert.equal(scoped[0]?.scopeId, "session-a");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("SqliteTodoStore nextReady filters by scope", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-sqlite-todos-ready-scope-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    await store.create({ id: "a", text: "A", scopeId: "session-a" });
    await store.create({ id: "b", text: "B", scopeId: "session-b" });

    const ready = await store.nextReady({ scopeId: "session-b" });
    assert.deepEqual(
      ready.map((todo) => todo.id),
      ["b"],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("SqliteTodoStore cleanupDone deletes only done todos in the requested scope", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-sqlite-todos-cleanup-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    await store.create({ id: "a-done", text: "A done", scopeId: "session-a" });
    await store.create({ id: "a-open", text: "A open", scopeId: "session-a" });
    await store.create({ id: "b-done", text: "B done", scopeId: "session-b" });
    await store.update("a-done", { status: "done" }, "runner");
    await store.update("b-done", { status: "done" }, "runner");

    const cleaned = await store.cleanupDone("session-a", "system");
    assert.equal(cleaned, 1);
    assert.equal(await store.get("a-done"), undefined);
    assert.ok(await store.get("a-open"));
    assert.ok(await store.get("b-done"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("SqliteTodoStore migrates pre-scope databases and hides legacy rows from scoped lists", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-sqlite-todos-migrate-"));
  const dbPath = path.join(temp, "todos.sqlite");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        blocked_reason TEXT,
        metadata_json TEXT,
        locked_by TEXT,
        locked_at TEXT,
        lock_reason TEXT
      );
      INSERT INTO todos (id, text, status, priority, created_at, updated_at)
      VALUES ('legacy', 'Legacy', 'open', 0, 't', 't');
    `);
    db.close();

    const store = new SqliteTodoStore(dbPath);
    await store.create({ id: "scoped", text: "Scoped", scopeId: "session-a" });
    const scoped = await store.list({ scopeId: "session-a" });
    assert.deepEqual(
      scoped.map((todo) => todo.id),
      ["scoped"],
    );
    assert.ok(await store.get("legacy"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
