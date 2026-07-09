import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ToolDefinition, ToolExecutionContext } from "@micro-harnesses/core";
import { SqliteTodoStore } from "./sqliteTodoStore";
import { createTodoTools } from "./todoTools";

function getTool(tools: ToolDefinition[], name: string): ToolDefinition {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

function context(sessionId: string, runId: string): ToolExecutionContext {
  return { sessionId, runId, signal: new AbortController().signal };
}

test("todo tools scope create/list to sessionId instead of changing runId", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-scope-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    const tools = createTodoTools(store);
    const create = getTool(tools, "todo_create");
    const list = getTool(tools, "todo_list");

    await create.execute({ id: "session-a-task", text: "A" }, context("session-a", "run-1"));
    await create.execute({ id: "session-b-task", text: "B" }, context("session-b", "run-2"));

    const result = await list.execute({}, context("session-a", "run-3"));
    const todos = result.todos as Array<{ id: string; scopeId?: string }>;
    assert.deepEqual(
      todos.map((todo) => todo.id),
      ["session-a-task"],
    );
    assert.equal(todos[0]?.scopeId, "session-a");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("todo tools return completed todo from set_status then clean it on subsequent list", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-clean-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    const tools = createTodoTools(store);
    const create = getTool(tools, "todo_create");
    const setStatus = getTool(tools, "todo_set_status");
    const list = getTool(tools, "todo_list");

    await create.execute({ id: "done-task", text: "Done" }, context("session-a", "run-1"));
    const done = await setStatus.execute(
      { id: "done-task", status: "done" },
      context("session-a", "run-2"),
    );
    assert.equal((done.todo as { id: string; status: string }).id, "done-task");
    assert.equal((done.todo as { id: string; status: string }).status, "done");

    const listed = await list.execute({}, context("session-a", "run-3"));
    assert.equal(listed.cleaned, 1);
    assert.deepEqual(listed.todos, []);
    assert.equal(await store.get("done-task"), undefined);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("todo_next_ready uses sessionId owner and session scope across runs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-ready-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    const tools = createTodoTools(store);
    const create = getTool(tools, "todo_create");
    const nextReady = getTool(tools, "todo_next_ready");

    await create.execute({ id: "ready-a", text: "A" }, context("session-a", "run-1"));
    await create.execute({ id: "ready-b", text: "B" }, context("session-b", "run-2"));

    const result = await nextReady.execute({}, context("session-a", "run-3"));
    const todos = result.todos as Array<{ id: string }>;
    assert.deepEqual(
      todos.map((todo) => todo.id),
      ["ready-a"],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("id-based todo tools cannot read or mutate another session scope", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-cross-scope-"));
  try {
    const store = new SqliteTodoStore(path.join(temp, "todos.sqlite"));
    const tools = createTodoTools(store);
    const create = getTool(tools, "todo_create");
    const get = getTool(tools, "todo_get");
    const setStatus = getTool(tools, "todo_set_status");

    await create.execute({ id: "session-a-task", text: "A" }, context("session-a", "run-1"));

    const hidden = await get.execute({ id: "session-a-task" }, context("session-b", "run-2"));
    assert.equal(hidden.found, false);
    await assert.rejects(
      () =>
        setStatus.execute(
          { id: "session-a-task", status: "in_progress" },
          context("session-b", "run-3"),
        ),
      /out of scope/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
