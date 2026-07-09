export type TodoStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";

export interface TodoLock {
  owner: string;
  lockedAt: string;
  reason?: string;
}

export interface TodoRecord {
  id: string;
  text: string;
  status: TodoStatus;
  priority: number;
  scopeId?: string;
  createdAt: string;
  updatedAt: string;
  blockedReason?: string;
  metadata?: Record<string, unknown>;
  lock?: TodoLock;
}

export interface TodoDependency {
  todoId: string;
  dependsOn: string;
}

export interface TodoCreateInput {
  id?: string;
  text: string;
  priority?: number;
  scopeId?: string;
  metadata?: Record<string, unknown>;
}

export interface TodoUpdateInput {
  text?: string;
  priority?: number;
  status?: TodoStatus;
  blockedReason?: string;
  metadata?: Record<string, unknown>;
}

export interface TodoListQuery {
  status?: TodoStatus | TodoStatus[];
  includeLocked?: boolean;
  lockOwner?: string;
  scopeId?: string;
  limit?: number;
}

export interface TodoNextQuery {
  owner?: string;
  scopeId?: string;
  limit?: number;
}

/**
 * Storage-agnostic todo contract for long-horizon workflows.
 * Concrete backends (SQLite, remote services, etc.) enforce lock semantics.
 */
export interface TodoStore {
  create(input: TodoCreateInput): Promise<TodoRecord>;
  get(id: string): Promise<TodoRecord | undefined>;
  list(query?: TodoListQuery): Promise<TodoRecord[]>;
  update(id: string, input: TodoUpdateInput, actor: string): Promise<TodoRecord>;
  delete(id: string, actor: string): Promise<void>;
  addDependency(todoId: string, dependsOn: string): Promise<void>;
  removeDependency(todoId: string, dependsOn: string): Promise<void>;
  listDependencies(todoId: string): Promise<TodoDependency[]>;
  lock(id: string, owner: string, reason?: string): Promise<TodoRecord>;
  unlock(id: string, owner: string, force?: boolean): Promise<TodoRecord>;
  nextReady(query?: TodoNextQuery): Promise<TodoRecord[]>;
  cleanupDone?(scopeId: string, actor: string): Promise<number>;
}
