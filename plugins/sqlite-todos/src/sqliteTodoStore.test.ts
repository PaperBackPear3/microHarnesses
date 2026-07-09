import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
    assert.equal(before.some((todo) => todo.id === "next"), false);
    await store.update(base.id, { status: "done" }, "runner");
    const after = await store.nextReady();
    assert.equal(after.some((todo) => todo.id === "next"), true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
