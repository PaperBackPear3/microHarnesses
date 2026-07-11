import type {
  TodoStatus,
  TodoStore,
  TodoUpdateInput,
  ToolDefinition,
  ToolExecutionContext,
} from "@micro-harnesses/core";

type TodoStoreResolver = (context?: ToolExecutionContext) => Promise<TodoStore> | TodoStore;

export function createTodoTools(storeOrResolver: TodoStore | TodoStoreResolver): ToolDefinition[] {
  const resolveStore = toStoreResolver(storeOrResolver);
  return [
    createTodoCreateTool(resolveStore),
    createTodoGetTool(resolveStore),
    createTodoListTool(resolveStore),
    createTodoUpdateTool(resolveStore),
    createTodoSetStatusTool(resolveStore),
    createTodoDeleteTool(resolveStore),
    createTodoAddDependencyTool(resolveStore),
    createTodoRemoveDependencyTool(resolveStore),
    createTodoLockTool(resolveStore),
    createTodoUnlockTool(resolveStore),
    createTodoNextReadyTool(resolveStore),
  ];
}

function createTodoCreateTool(resolveStore: TodoStoreResolver): ToolDefinition {
  return {
    name: "todo_create",
    description: "Create a new persistent todo item with an auto-generated id.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        priority: { type: "number" },
        metadata: { type: "object" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const store = await resolveStore(context);
      const scopeId = resolveScope(context);
      const todo = await store.create({
        text: requiredString(input, "text"),
        priority: optionalNumber(input, "priority"),
        ...(scopeId ? { scopeId } : {}),
        ...(isRecord(input.metadata) ? { metadata: input.metadata } : {}),
      });
      return { todo };
    },
  };
}

function createTodoGetTool(resolveStore: TodoStoreResolver): ToolDefinition {
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
    async execute(input, context) {
      const store = await resolveStore(context);
      const todo = await getScopedTodo(store, requiredString(input, "id"), resolveScope(context));
      return { found: Boolean(todo), ...(todo ? { todo } : {}) };
    },
  };
}

function createTodoListTool(resolveStore: TodoStoreResolver): ToolDefinition {
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
    async execute(input, context) {
      const store = await resolveStore(context);
      const status = normalizeStatusFilter(input.status);
      const scopeId = resolveScope(context);
      const cleaned = await cleanupDoneForScope(store, scopeId);
      const todos = await store.list({
        ...(status ? { status } : {}),
        includeLocked: optionalBoolean(input, "include_locked"),
        ...(typeof input.lock_owner === "string" ? { lockOwner: input.lock_owner } : {}),
        ...(scopeId ? { scopeId } : {}),
        limit: optionalNumber(input, "limit"),
      });
      return { count: todos.length, cleaned, todos };
    },
  };
}

function createTodoUpdateTool(resolveStore: TodoStoreResolver): ToolDefinition {
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
      const store = await resolveStore(context);
      const id = requiredString(input, "id");
      const actor = resolveActor(input, context);
      await assertTodoInScope(store, id, resolveScope(context));
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

function createTodoSetStatusTool(resolveStore: TodoStoreResolver): ToolDefinition {
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
      const store = await resolveStore(context);
      const id = requiredString(input, "id");
      const status = parseTodoStatus(requiredString(input, "status"));
      const actor = resolveActor(input, context);
      await assertTodoInScope(store, id, resolveScope(context));
      const todo = await store.update(
        id,
        {
          status,
          ...(typeof input.blocked_reason === "string"
            ? { blockedReason: input.blocked_reason }
            : {}),
        },
        actor,
      );
      return { todo };
    },
  };
}

function createTodoDeleteTool(resolveStore: TodoStoreResolver): ToolDefinition {
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
      const store = await resolveStore(context);
      const id = requiredString(input, "id");
      const actor = resolveActor(input, context);
      await assertTodoInScope(store, id, resolveScope(context));
      await store.delete(id, actor);
      return { ok: true, id };
    },
  };
}

function createTodoAddDependencyTool(resolveStore: TodoStoreResolver): ToolDefinition {
  return {
    name: "todo_add_dependency",
    description: "Add a dependency edge: todo_id depends_on.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        todo_id: { type: "string" },
        depends_on: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
      },
      required: ["todo_id", "depends_on"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const store = await resolveStore(context);
      const todoId = requiredString(input, "todo_id");
      const dependsOn = parseDependsOnInput(input.depends_on);
      const scopeId = resolveScope(context);
      await assertTodoInScope(store, todoId, scopeId);
      for (const dependencyId of dependsOn) {
        await assertTodoInScope(store, dependencyId, scopeId);
        await store.addDependency(todoId, dependencyId);
      }
      return { ok: true, todoId, dependsOn, count: dependsOn.length };
    },
  };
}

function createTodoRemoveDependencyTool(resolveStore: TodoStoreResolver): ToolDefinition {
  return {
    name: "todo_remove_dependency",
    description: "Remove a dependency edge: todo_id depends_on.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        todo_id: { type: "string" },
        depends_on: {
          oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
        },
      },
      required: ["todo_id", "depends_on"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const store = await resolveStore(context);
      const todoId = requiredString(input, "todo_id");
      const dependsOn = parseDependsOnInput(input.depends_on);
      const scopeId = resolveScope(context);
      await assertTodoInScope(store, todoId, scopeId);
      for (const dependencyId of dependsOn) {
        await assertTodoInScope(store, dependencyId, scopeId);
        await store.removeDependency(todoId, dependencyId);
      }
      return { ok: true, todoId, dependsOn, count: dependsOn.length };
    },
  };
}

function createTodoLockTool(resolveStore: TodoStoreResolver): ToolDefinition {
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
      const store = await resolveStore(context);
      const id = requiredString(input, "id");
      const owner = resolveActor(input, context);
      await assertTodoInScope(store, id, resolveScope(context));
      const todo = await store.lock(
        id,
        owner,
        typeof input.reason === "string" ? input.reason : undefined,
      );
      return { todo };
    },
  };
}

function createTodoUnlockTool(resolveStore: TodoStoreResolver): ToolDefinition {
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
      const store = await resolveStore(context);
      const id = requiredString(input, "id");
      const owner = resolveActor(input, context);
      const force = optionalBoolean(input, "force") ?? false;
      await assertTodoInScope(store, id, resolveScope(context));
      const todo = await store.unlock(id, owner, force);
      return { todo };
    },
  };
}

function createTodoNextReadyTool(resolveStore: TodoStoreResolver): ToolDefinition {
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
      const store = await resolveStore(context);
      const scopeId = resolveScope(context);
      const owner =
        typeof input.owner === "string" ? input.owner : (context?.sessionId ?? context?.runId);
      const cleaned = await cleanupDoneForScope(store, scopeId);
      const todos = await store.nextReady({
        ...(owner ? { owner } : {}),
        ...(scopeId ? { scopeId } : {}),
        limit: optionalNumber(input, "limit"),
      });
      return { count: todos.length, cleaned, todos };
    },
  };
}

function resolveActor(input: Record<string, unknown>, context?: ToolExecutionContext): string {
  const actor =
    (typeof input.actor === "string" ? input.actor : undefined) ??
    (typeof input.owner === "string" ? input.owner : undefined) ??
    context?.sessionId ??
    context?.runId;
  if (!actor || actor.trim().length === 0) {
    throw new Error("Mutation requires actor/owner or runtime run/session id");
  }
  return actor.trim();
}

function resolveScope(context?: ToolExecutionContext): string | undefined {
  return context?.sessionId?.trim() || undefined;
}

async function cleanupDoneForScope(store: TodoStore, scopeId: string | undefined): Promise<number> {
  if (!scopeId || !store.cleanupDone) return 0;
  return await store.cleanupDone(scopeId, "system");
}

async function getScopedTodo(
  store: TodoStore,
  id: string,
  scopeId: string | undefined,
): Promise<Awaited<ReturnType<TodoStore["get"]>>> {
  const todo = await store.get(id);
  if (!todo || !scopeId) return todo;
  return todo.scopeId === scopeId ? todo : undefined;
}

async function assertTodoInScope(
  store: TodoStore,
  id: string,
  scopeId: string | undefined,
): Promise<void> {
  if (!scopeId) return;
  const todo = await store.get(id);
  if (!todo) throw new Error(`Unknown todo "${id}"`);
  if (todo.scopeId !== scopeId) {
    throw new Error(`Todo "${id}" is out of scope for this session`);
  }
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

function parseDependsOnInput(value: unknown): string[] {
  if (typeof value === "string") return [requiredNonEmptyString(value, "depends_on")];
  if (!Array.isArray(value)) {
    throw new Error('"depends_on" must be a non-empty string or an array of non-empty strings');
  }
  const dependsOn = Array.from(
    new Set(value.map((entry) => requiredNonEmptyString(entry, "depends_on"))),
  );
  if (dependsOn.length === 0) {
    throw new Error('"depends_on" must include at least one dependency id');
  }
  return dependsOn;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  return requiredNonEmptyString(input[key], key);
}

function requiredNonEmptyString(value: unknown, key: string): string {
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

function toStoreResolver(storeOrResolver: TodoStore | TodoStoreResolver): TodoStoreResolver {
  if (typeof storeOrResolver === "function") {
    return storeOrResolver;
  }
  return () => storeOrResolver;
}
