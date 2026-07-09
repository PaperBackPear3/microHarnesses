import type { ToolDefinition, ToolExecutionContext, TodoStatus, TodoStore, TodoUpdateInput } from "@micro-harnesses/core";

export function createTodoTools(store: TodoStore): ToolDefinition[] {
  return [
    createTodoCreateTool(store),
    createTodoGetTool(store),
    createTodoListTool(store),
    createTodoUpdateTool(store),
    createTodoSetStatusTool(store),
    createTodoDeleteTool(store),
    createTodoAddDependencyTool(store),
    createTodoRemoveDependencyTool(store),
    createTodoLockTool(store),
    createTodoUnlockTool(store),
    createTodoNextReadyTool(store),
  ];
}

function createTodoCreateTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_create",
    description: "Create a new persistent todo item.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        priority: { type: "number" },
        metadata: { type: "object" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    async execute(input) {
      const todo = await store.create({
        ...(typeof input.id === "string" ? { id: input.id } : {}),
        text: requiredString(input, "text"),
        priority: optionalNumber(input, "priority"),
        ...(isRecord(input.metadata) ? { metadata: input.metadata } : {}),
      });
      return { todo };
    },
  };
}

function createTodoGetTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_get",
    description: "Fetch one todo by id.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input) {
      const todo = await store.get(requiredString(input, "id"));
      return { found: Boolean(todo), ...(todo ? { todo } : {}) };
    },
  };
}

function createTodoListTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_list",
    description: "List todos with optional status and lock filters.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
        include_locked: { type: "boolean" },
        lock_owner: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    async execute(input) {
      const status = normalizeStatusFilter(input.status);
      const todos = await store.list({
        ...(status ? { status } : {}),
        includeLocked: optionalBoolean(input, "include_locked"),
        ...(typeof input.lock_owner === "string" ? { lockOwner: input.lock_owner } : {}),
        limit: optionalNumber(input, "limit"),
      });
      return { count: todos.length, todos };
    },
  };
}

function createTodoUpdateTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_update",
    description: "Update todo fields (lock-aware).",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        actor: { type: "string" },
        text: { type: "string" },
        priority: { type: "number" },
        blocked_reason: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const id = requiredString(input, "id");
      const actor = resolveActor(input, context);
      const patch: TodoUpdateInput = {};
      if (typeof input.text === "string") patch.text = input.text;
      if (typeof input.priority === "number") patch.priority = input.priority;
      if (typeof input.blocked_reason === "string") patch.blockedReason = input.blocked_reason;
      if (isRecord(input.metadata)) patch.metadata = input.metadata;
      const todo = await store.update(id, patch, actor);
      return { todo };
    },
  };
}

function createTodoSetStatusTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_set_status",
    description: "Set todo status (open/in_progress/blocked/done/cancelled).",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string" },
        actor: { type: "string" },
        blocked_reason: { type: "string" },
      },
      required: ["id", "status"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const id = requiredString(input, "id");
      const status = parseTodoStatus(requiredString(input, "status"));
      const actor = resolveActor(input, context);
      const todo = await store.update(
        id,
        {
          status,
          ...(typeof input.blocked_reason === "string" ? { blockedReason: input.blocked_reason } : {}),
        },
        actor,
      );
      return { todo };
    },
  };
}

function createTodoDeleteTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_delete",
    description: "Delete a todo (lock-aware).",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        actor: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const id = requiredString(input, "id");
      const actor = resolveActor(input, context);
      await store.delete(id, actor);
      return { ok: true, id };
    },
  };
}

function createTodoAddDependencyTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_add_dependency",
    description: "Add a dependency edge: todo_id depends_on.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        todo_id: { type: "string" },
        depends_on: { type: "string" },
      },
      required: ["todo_id", "depends_on"],
      additionalProperties: false,
    },
    async execute(input) {
      const todoId = requiredString(input, "todo_id");
      const dependsOn = requiredString(input, "depends_on");
      await store.addDependency(todoId, dependsOn);
      return { ok: true, todoId, dependsOn };
    },
  };
}

function createTodoRemoveDependencyTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_remove_dependency",
    description: "Remove a dependency edge: todo_id depends_on.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        todo_id: { type: "string" },
        depends_on: { type: "string" },
      },
      required: ["todo_id", "depends_on"],
      additionalProperties: false,
    },
    async execute(input) {
      const todoId = requiredString(input, "todo_id");
      const dependsOn = requiredString(input, "depends_on");
      await store.removeDependency(todoId, dependsOn);
      return { ok: true, todoId, dependsOn };
    },
  };
}

function createTodoLockTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_lock",
    description: "Hard-lock a todo for an owner.",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        owner: { type: "string" },
        reason: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const id = requiredString(input, "id");
      const owner = resolveActor(input, context);
      const todo = await store.lock(id, owner, typeof input.reason === "string" ? input.reason : undefined);
      return { todo };
    },
  };
}

function createTodoUnlockTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_unlock",
    description: "Unlock a todo. Only owner can unlock unless force=true.",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        owner: { type: "string" },
        force: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const id = requiredString(input, "id");
      const owner = resolveActor(input, context);
      const force = optionalBoolean(input, "force") ?? false;
      const todo = await store.unlock(id, owner, force);
      return { todo };
    },
  };
}

function createTodoNextReadyTool(store: TodoStore): ToolDefinition {
  return {
    name: "todo_next_ready",
    description: "Return next ready todos for long-horizon execution.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    async execute(input, context) {
      const owner = typeof input.owner === "string" ? input.owner : context?.runId ?? context?.sessionId;
      const todos = await store.nextReady({
        ...(owner ? { owner } : {}),
        limit: optionalNumber(input, "limit"),
      });
      return { count: todos.length, todos };
    },
  };
}

function resolveActor(input: Record<string, unknown>, context?: ToolExecutionContext): string {
  const actor =
    (typeof input.actor === "string" ? input.actor : undefined) ??
    (typeof input.owner === "string" ? input.owner : undefined) ??
    context?.runId ??
    context?.sessionId;
  if (!actor || actor.trim().length === 0) {
    throw new Error("Mutation requires actor/owner or runtime run/session id");
  }
  return actor.trim();
}

function normalizeStatusFilter(raw: unknown): TodoStatus | TodoStatus[] | undefined {
  if (typeof raw === "string") return parseTodoStatus(raw);
  if (Array.isArray(raw)) return raw.map((item) => parseTodoStatus(String(item)));
  return undefined;
}

function parseTodoStatus(value: string): TodoStatus {
  if (
    value === "open" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "done" ||
    value === "cancelled"
  ) {
    return value;
  }
  throw new Error(`Invalid todo status "${value}"`);
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return value.trim();
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (typeof value !== "boolean") return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
