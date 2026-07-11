import path from "node:path";
import type {
  HarnessPlugin,
  PluginApi,
  PluginCapability,
  ToolExecutionContext,
} from "@micro-harnesses/core";
import { resolveSqliteTodosOptions, type SqliteTodosPluginOptions } from "./options";
import { SqliteTodoStore } from "./sqliteTodoStore";
import { createTodoTools } from "./todoTools";

export class SqliteTodosPlugin implements HarnessPlugin {
  readonly name = "sqlite-todos-plugin";
  readonly capabilities: PluginCapability[] = ["tools"];

  private readonly sessionsDir: string;
  private readonly stores = new Map<string, SqliteTodoStore>();

  constructor(options: SqliteTodosPluginOptions = {}) {
    const resolved = resolveSqliteTodosOptions(options);
    this.sessionsDir = resolved.sessionsDir;
  }

  register(api: PluginApi): void {
    for (const tool of createTodoTools((context) => this.storeForContext(context))) {
      api.registerTool(tool);
    }
  }

  private storeForContext(context?: ToolExecutionContext): SqliteTodoStore {
    const sessionId = context?.sessionId?.trim();
    if (!sessionId) {
      throw new Error("todo tools require a sessionId in tool context");
    }
    const existing = this.stores.get(sessionId);
    if (existing) return existing;

    const dbPath = path.join(this.sessionsDir, sessionId, "todos.sqlite");
    const created = new SqliteTodoStore(dbPath);
    this.stores.set(sessionId, created);
    return created;
  }
}
