import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  TodoCreateInput,
  TodoDependency,
  TodoListQuery,
  TodoNextQuery,
  TodoRecord,
  TodoStatus,
  TodoStore,
  TodoUpdateInput,
} from "@micro-harnesses/core";

type TodoRow = {
  id: string;
  text: string;
  status: TodoStatus;
  priority: number;
  scope_id: string | null;
  created_at: string;
  updated_at: string;
  blocked_reason: string | null;
  metadata_json: string | null;
  locked_by: string | null;
  locked_at: string | null;
  lock_reason: string | null;
};

interface TodoFilters {
  status?: TodoStatus[];
  includeLocked: boolean;
  lockOwner?: string;
  scopeId?: string;
  limit: number;
}

type SqlArg = string | number | bigint | Uint8Array | null;

export class SqliteTodoStore implements TodoStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.bootstrap();
  }

  async create(input: TodoCreateInput): Promise<TodoRecord> {
    const text = String(input.text ?? "").trim();
    if (!text) throw new Error("Todo text is required");
    const now = new Date().toISOString();
    const id = input.id?.trim() || `todo-${randomUUID()}`;
    const priority = normalizePriority(input.priority);
    const scopeId = input.scopeId?.trim() || null;
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
    this.db
      .prepare(
        `INSERT INTO todos (
          id, text, status, priority, scope_id, created_at, updated_at, metadata_json
        ) VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`,
      )
      .run(id, text, priority, scopeId, now, now, metadataJson);
    this.insertEvent(id, "created", "system", { text, priority, scopeId });
    return this.requireTodo(id);
  }

  async get(id: string): Promise<TodoRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as TodoRow | undefined;
    return row ? mapTodoRow(row) : undefined;
  }

  async list(query: TodoListQuery = {}): Promise<TodoRecord[]> {
    const filters = normalizeListQuery(query);
    const clauses: string[] = [];
    const args: SqlArg[] = [];

    if (filters.status && filters.status.length > 0) {
      clauses.push(`status IN (${filters.status.map(() => "?").join(", ")})`);
      args.push(...filters.status);
    }
    if (!filters.includeLocked) {
      clauses.push("locked_by IS NULL");
    } else if (filters.lockOwner) {
      clauses.push("(locked_by IS NULL OR locked_by = ?)");
      args.push(filters.lockOwner);
    }
    if (filters.scopeId) {
      clauses.push("scope_id = ?");
      args.push(filters.scopeId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `
      SELECT * FROM todos
      ${where}
      ORDER BY priority DESC, updated_at ASC
      LIMIT ?
    `;
    args.push(filters.limit);
    const rows = this.db.prepare(sql).all(...args) as TodoRow[];
    return rows.map(mapTodoRow);
  }

  async update(id: string, input: TodoUpdateInput, actor: string): Promise<TodoRecord> {
    const todo = await this.requireTodo(id);
    assertCanMutate(todo, actor);

    const updates: string[] = [];
    const args: SqlArg[] = [];
    if (typeof input.text === "string") {
      const text = input.text.trim();
      if (!text) throw new Error("Todo text cannot be empty");
      updates.push("text = ?");
      args.push(text);
    }
    if (typeof input.priority === "number") {
      updates.push("priority = ?");
      args.push(normalizePriority(input.priority));
    }
    if (input.status) {
      updates.push("status = ?");
      args.push(assertStatus(input.status));
    }
    if (typeof input.blockedReason === "string") {
      updates.push("blocked_reason = ?");
      args.push(input.blockedReason.trim() || null);
    }
    if (input.metadata) {
      updates.push("metadata_json = ?");
      args.push(JSON.stringify(input.metadata));
    }
    if (updates.length === 0) return todo;

    updates.push("updated_at = ?");
    args.push(new Date().toISOString());
    args.push(id);
    this.db.prepare(`UPDATE todos SET ${updates.join(", ")} WHERE id = ?`).run(...args);
    this.insertEvent(id, "updated", actor, toEventPayload(input));
    return this.requireTodo(id);
  }

  async delete(id: string, actor: string): Promise<void> {
    const todo = await this.requireTodo(id);
    assertCanMutate(todo, actor);
    this.inTransaction(() => {
      this.db.prepare("DELETE FROM todo_deps WHERE todo_id = ? OR depends_on = ?").run(id, id);
      this.db.prepare("DELETE FROM todos WHERE id = ?").run(id);
      this.insertEvent(id, "deleted", actor, {});
    });
  }

  async addDependency(todoId: string, dependsOn: string): Promise<void> {
    if (todoId === dependsOn) throw new Error("A todo cannot depend on itself");
    await this.requireTodo(todoId);
    await this.requireTodo(dependsOn);
    this.db
      .prepare("INSERT OR IGNORE INTO todo_deps (todo_id, depends_on) VALUES (?, ?)")
      .run(todoId, dependsOn);
    this.insertEvent(todoId, "dependency_added", "system", { dependsOn });
  }

  async removeDependency(todoId: string, dependsOn: string): Promise<void> {
    this.db
      .prepare("DELETE FROM todo_deps WHERE todo_id = ? AND depends_on = ?")
      .run(todoId, dependsOn);
    this.insertEvent(todoId, "dependency_removed", "system", { dependsOn });
  }

  async listDependencies(todoId: string): Promise<TodoDependency[]> {
    const rows = this.db
      .prepare(
        "SELECT todo_id, depends_on FROM todo_deps WHERE todo_id = ? ORDER BY depends_on ASC",
      )
      .all(todoId) as Array<{ todo_id: string; depends_on: string }>;
    return rows.map((row) => ({ todoId: row.todo_id, dependsOn: row.depends_on }));
  }

  async lock(id: string, owner: string, reason?: string): Promise<TodoRecord> {
    const cleanOwner = owner.trim();
    if (!cleanOwner) throw new Error("Lock owner is required");
    const todo = await this.requireTodo(id);
    if (todo.lock && todo.lock.owner !== cleanOwner) {
      throw new Error(`Todo "${id}" is locked by "${todo.lock.owner}"`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE todos SET locked_by = ?, locked_at = ?, lock_reason = ?, updated_at = ? WHERE id = ?",
      )
      .run(cleanOwner, now, reason?.trim() || null, now, id);
    this.insertEvent(id, "locked", cleanOwner, { reason: reason ?? null });
    return this.requireTodo(id);
  }

  async unlock(id: string, owner: string, force = false): Promise<TodoRecord> {
    const cleanOwner = owner.trim();
    if (!cleanOwner) throw new Error("Unlock owner is required");
    const todo = await this.requireTodo(id);
    if (todo.lock && todo.lock.owner !== cleanOwner && !force) {
      throw new Error(`Todo "${id}" is locked by "${todo.lock.owner}"`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE todos SET locked_by = NULL, locked_at = NULL, lock_reason = NULL, updated_at = ? WHERE id = ?",
      )
      .run(now, id);
    this.insertEvent(id, "unlocked", cleanOwner, { force });
    return this.requireTodo(id);
  }

  async nextReady(query: TodoNextQuery = {}): Promise<TodoRecord[]> {
    const limit = clampLimit(query.limit);
    const owner = query.owner?.trim();
    const scopeId = query.scopeId?.trim();
    const args: SqlArg[] = [];
    let lockFilter = "t.locked_by IS NULL";
    if (owner) {
      lockFilter = "(t.locked_by IS NULL OR t.locked_by = ?)";
      args.push(owner);
    }
    if (scopeId) args.push(scopeId);
    args.push(limit);
    const sql = `
      SELECT t.*
      FROM todos t
      WHERE t.status IN ('open', 'in_progress')
        AND ${lockFilter}
        ${scopeId ? "AND t.scope_id = ?" : ""}
        AND NOT EXISTS (
          SELECT 1
          FROM todo_deps td
          JOIN todos dep ON dep.id = td.depends_on
          WHERE td.todo_id = t.id
            AND dep.status NOT IN ('done', 'cancelled')
        )
      ORDER BY t.priority DESC, t.updated_at ASC
      LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(...args) as TodoRow[];
    return rows.map(mapTodoRow);
  }

  async cleanupDone(scopeId: string, actor: string): Promise<number> {
    const cleanScope = scopeId.trim();
    const cleanActor = actor.trim() || "system";
    if (!cleanScope) throw new Error("cleanupDone requires scopeId");
    return this.inTransaction(() => {
      const rows = this.db
        .prepare("SELECT id FROM todos WHERE scope_id = ? AND status = 'done'")
        .all(cleanScope) as Array<{ id: string }>;
      for (const row of rows) {
        this.db
          .prepare("DELETE FROM todo_deps WHERE todo_id = ? OR depends_on = ?")
          .run(row.id, row.id);
        this.db.prepare("DELETE FROM todos WHERE id = ?").run(row.id);
        this.insertEvent(row.id, "deleted", cleanActor, { cleanup: true, scopeId: cleanScope });
      }
      return rows.length;
    });
  }

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        scope_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        blocked_reason TEXT,
        metadata_json TEXT,
        locked_by TEXT,
        locked_at TEXT,
        lock_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS todo_deps (
        todo_id TEXT NOT NULL,
        depends_on TEXT NOT NULL,
        PRIMARY KEY (todo_id, depends_on),
        FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on) REFERENCES todos(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS todo_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        todo_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_todos_status_priority_updated
        ON todos (status, priority DESC, updated_at ASC);
      CREATE INDEX IF NOT EXISTS idx_todos_locked_by ON todos (locked_by);
      CREATE INDEX IF NOT EXISTS idx_todo_deps_todo_id ON todo_deps (todo_id);
      CREATE INDEX IF NOT EXISTS idx_todo_deps_depends_on ON todo_deps (depends_on);
    `);
    this.migrateScopeColumn();
  }

  private migrateScopeColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(todos)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "scope_id")) {
      this.db.exec("ALTER TABLE todos ADD COLUMN scope_id TEXT;");
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_todos_scope_status_priority_updated
        ON todos (scope_id, status, priority DESC, updated_at ASC);
    `);
  }

  private insertEvent(
    todoId: string,
    type: string,
    actor: string,
    payload: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        "INSERT INTO todo_events (todo_id, type, actor, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(todoId, type, actor, JSON.stringify(payload), new Date().toISOString());
  }

  private async requireTodo(id: string): Promise<TodoRecord> {
    const todo = await this.get(id);
    if (!todo) throw new Error(`Unknown todo "${id}"`);
    return todo;
  }

  private inTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = work();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function normalizeListQuery(query: TodoListQuery): TodoFilters {
  const status =
    typeof query.status === "string"
      ? [assertStatus(query.status)]
      : query.status
        ? query.status.map(assertStatus)
        : undefined;
  return {
    status,
    includeLocked: query.includeLocked ?? true,
    lockOwner: query.lockOwner?.trim(),
    scopeId: query.scopeId?.trim(),
    limit: clampLimit(query.limit),
  };
}

function mapTodoRow(row: TodoRow): TodoRecord {
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    priority: row.priority,
    ...(row.scope_id ? { scopeId: row.scope_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    ...(row.metadata_json
      ? { metadata: JSON.parse(row.metadata_json) as Record<string, unknown> }
      : {}),
    ...(row.locked_by && row.locked_at
      ? {
          lock: {
            owner: row.locked_by,
            lockedAt: row.locked_at,
            ...(row.lock_reason ? { reason: row.lock_reason } : {}),
          },
        }
      : {}),
  };
}

function assertCanMutate(todo: TodoRecord, actor: string): void {
  const cleanActor = actor.trim();
  if (!cleanActor) throw new Error("Mutation requires an actor");
  if (todo.lock && todo.lock.owner !== cleanActor) {
    throw new Error(`Todo "${todo.id}" is locked by "${todo.lock.owner}"`);
  }
}

function assertStatus(status: string): TodoStatus {
  if (
    status === "open" ||
    status === "in_progress" ||
    status === "blocked" ||
    status === "done" ||
    status === "cancelled"
  ) {
    return status;
  }
  throw new Error(`Invalid todo status "${status}"`);
}

function normalizePriority(value: number | undefined): number {
  const priority = Number.isFinite(value) ? Math.round(value as number) : 0;
  return Math.max(-100, Math.min(100, priority));
}

function clampLimit(value: number | undefined): number {
  const limit = Number.isFinite(value) ? Math.round(value as number) : 50;
  return Math.max(1, Math.min(200, limit));
}

function toEventPayload(input: TodoUpdateInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (typeof input.text === "string") payload.text = input.text;
  if (typeof input.priority === "number") payload.priority = input.priority;
  if (typeof input.status === "string") payload.status = input.status;
  if (typeof input.blockedReason === "string") payload.blockedReason = input.blockedReason;
  if (input.metadata) payload.metadata = input.metadata;
  return payload;
}
