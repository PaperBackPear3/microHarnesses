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

function createSessionResolver(rootDir: string) {
  const stores = new Map<string, SqliteTodoStore>();
  return (ctx?: ToolExecutionContext): SqliteTodoStore => {
    const sessionId = ctx?.sessionId?.trim();
    if (!sessionId) throw new Error("todo tools require a sessionId in tool context");
    const existing = stores.get(sessionId);
    if (existing) return existing;
    const created = new SqliteTodoStore(path.join(rootDir, sessionId, "todos.sqlite"));
    stores.set(sessionId, created);
    return created;
  };
}

test("todo tools scope create/list to sessionId instead of changing runId", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-scope-"));
  try {
    const tools = createTodoTools(createSessionResolver(temp));
    const create = getTool(tools, "todo_create");
    const list = getTool(tools, "todo_list");

    await create.execute({ text: "A" }, context("session-a", "run-1"));
    await create.execute({ text: "B" }, context("session-b", "run-2"));

    const result = await list.execute({}, context("session-a", "run-3"));
    const todos = result.todos as Array<{ id: string; text: string; scopeId?: string }>;
    assert.deepEqual(
      todos.map((todo) => todo.text),
      ["A"],
    );
    assert.equal(typeof todos[0]?.id, "string");
    assert.equal(todos[0]?.scopeId, "session-a");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("todo tools return completed todo from set_status then clean it on subsequent list", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-clean-"));
  try {
    const resolver = createSessionResolver(temp);
    const tools = createTodoTools(resolver);
    const create = getTool(tools, "todo_create");
    const setStatus = getTool(tools, "todo_set_status");
    const list = getTool(tools, "todo_list");

    const created = await create.execute({ text: "Done" }, context("session-a", "run-1"));
    const doneId = (created.todo as { id: string }).id;
    const done = await setStatus.execute(
      { id: doneId, status: "done" },
      context("session-a", "run-2"),
    );
    assert.equal((done.todo as { id: string; status: string }).id, doneId);
    assert.equal((done.todo as { id: string; status: string }).status, "done");

    const listed = await list.execute({}, context("session-a", "run-3"));
    assert.equal(listed.cleaned, 1);
    assert.deepEqual(listed.todos, []);
    const store = resolver(context("session-a", "run-4"));
    assert.equal(await store.get(doneId), undefined);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("todo_next_ready uses sessionId owner and session scope across runs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-ready-"));
  try {
    const tools = createTodoTools(createSessionResolver(temp));
    const create = getTool(tools, "todo_create");
    const nextReady = getTool(tools, "todo_next_ready");

    await create.execute({ text: "A" }, context("session-a", "run-1"));
    await create.execute({ text: "B" }, context("session-b", "run-2"));

    const result = await nextReady.execute({}, context("session-a", "run-3"));
    const todos = result.todos as Array<{ id: string; text: string }>;
    assert.deepEqual(
      todos.map((todo) => todo.text),
      ["A"],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("id-based todo tools cannot read or mutate another session scope", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-cross-scope-"));
  try {
    const tools = createTodoTools(createSessionResolver(temp));
    const create = getTool(tools, "todo_create");
    const get = getTool(tools, "todo_get");
    const setStatus = getTool(tools, "todo_set_status");

    const created = await create.execute({ text: "A" }, context("session-a", "run-1"));
    const sessionATodoId = (created.todo as { id: string }).id;

    const hidden = await get.execute({ id: sessionATodoId }, context("session-b", "run-2"));
    assert.equal(hidden.found, false);
    await assert.rejects(
      () =>
        setStatus.execute(
          { id: sessionATodoId, status: "in_progress" },
          context("session-b", "run-3"),
        ),
      /Unknown todo|out of scope/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("auto-generated todo ids remain session-isolated", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-session-isolated-create-"));
  try {
    const tools = createTodoTools(createSessionResolver(temp));
    const create = getTool(tools, "todo_create");
    const list = getTool(tools, "todo_list");

    const createdA = await create.execute({ text: "A" }, context("session-a", "run-1"));
    const createdB = await create.execute({ text: "B" }, context("session-b", "run-2"));
    const idA = (createdA.todo as { id: string }).id;
    const idB = (createdB.todo as { id: string }).id;
    assert.notEqual(idA, idB);

    const a = await list.execute({}, context("session-a", "run-3"));
    const b = await list.execute({}, context("session-b", "run-4"));
    assert.deepEqual(
      (a.todos as Array<{ id: string; text: string }>).map((todo) => todo.text),
      ["A"],
    );
    assert.deepEqual(
      (b.todos as Array<{ id: string; text: string }>).map((todo) => todo.text),
      ["B"],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("todo tools fail when session context is missing", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-missing-session-"));
  try {
    const tools = createTodoTools(createSessionResolver(temp));
    const create = getTool(tools, "todo_create");
    await assert.rejects(
      () =>
        create.execute({ text: "X" }, { runId: "run-1", signal: new AbortController().signal }),
      /sessionId/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("todo dependency tools accept single-string depends_on for compatibility", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-dep-single-"));
  try {
    const resolver = createSessionResolver(temp);
    const tools = createTodoTools(resolver);
    const create = getTool(tools, "todo_create");
    const addDependency = getTool(tools, "todo_add_dependency");

    const createdA = await create.execute({ text: "A" }, context("session-a", "run-1"));
    const createdB = await create.execute({ text: "B" }, context("session-a", "run-2"));
    const todoA = (createdA.todo as { id: string }).id;
    const todoB = (createdB.todo as { id: string }).id;

    const result = await addDependency.execute(
      { todo_id: todoA, depends_on: todoB },
      context("session-a", "run-3"),
    );

    assert.deepEqual(result.dependsOn, [todoB]);
    assert.equal(result.count, 1);
    const deps = await resolver(context("session-a", "run-4")).listDependencies(todoA);
    assert.deepEqual(
      deps.map((dependency) => dependency.dependsOn),
      [todoB],
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("todo dependency tools support arrays for add/remove", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-dep-array-"));
  try {
    const resolver = createSessionResolver(temp);
    const tools = createTodoTools(resolver);
    const create = getTool(tools, "todo_create");
    const addDependency = getTool(tools, "todo_add_dependency");
    const removeDependency = getTool(tools, "todo_remove_dependency");

    const createdA = await create.execute({ text: "A" }, context("session-a", "run-1"));
    const createdB = await create.execute({ text: "B" }, context("session-a", "run-2"));
    const createdC = await create.execute({ text: "C" }, context("session-a", "run-3"));
    const todoA = (createdA.todo as { id: string }).id;
    const todoB = (createdB.todo as { id: string }).id;
    const todoC = (createdC.todo as { id: string }).id;

    const added = await addDependency.execute(
      { todo_id: todoA, depends_on: [todoB, todoC] },
      context("session-a", "run-4"),
    );
    assert.deepEqual(added.dependsOn, [todoB, todoC]);
    assert.equal(added.count, 2);

    const removed = await removeDependency.execute(
      { todo_id: todoA, depends_on: [todoB, todoC] },
      context("session-a", "run-5"),
    );
    assert.deepEqual(removed.dependsOn, [todoB, todoC]);
    assert.equal(removed.count, 2);
    assert.deepEqual(await resolver(context("session-a", "run-6")).listDependencies(todoA), []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("todo dependency tools de-duplicate duplicate entries in depends_on array", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "mh-todo-tools-dep-dedupe-"));
  try {
    const resolver = createSessionResolver(temp);
    const tools = createTodoTools(resolver);
    const create = getTool(tools, "todo_create");
    const addDependency = getTool(tools, "todo_add_dependency");
    const removeDependency = getTool(tools, "todo_remove_dependency");

    const createdA = await create.execute({ text: "A" }, context("session-a", "run-1"));
    const createdB = await create.execute({ text: "B" }, context("session-a", "run-2"));
    const todoA = (createdA.todo as { id: string }).id;
    const todoB = (createdB.todo as { id: string }).id;

    const added = await addDependency.execute(
      { todo_id: todoA, depends_on: [todoB, todoB, todoB] },
      context("session-a", "run-3"),
    );
    assert.deepEqual(added.dependsOn, [todoB]);
    assert.equal(added.count, 1);

    const removed = await removeDependency.execute(
      { todo_id: todoA, depends_on: [todoB, todoB] },
      context("session-a", "run-4"),
    );
    assert.deepEqual(removed.dependsOn, [todoB]);
    assert.equal(removed.count, 1);
    assert.deepEqual(await resolver(context("session-a", "run-5")).listDependencies(todoA), []);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
