import type { HarnessPlugin, PluginApi, PluginCapability } from "@micro-harnesses/core";
import { resolveSqliteTodosOptions, type SqliteTodosPluginOptions } from "./options";
import { SqliteTodoStore } from "./sqliteTodoStore";
import { createTodoTools } from "./todoTools";

export class SqliteTodosPlugin implements HarnessPlugin {
  readonly name = "sqlite-todos-plugin";
  readonly capabilities: PluginCapability[] = ["tools"];

  private readonly store: SqliteTodoStore;

  constructor(options: SqliteTodosPluginOptions = {}) {
    const resolved = resolveSqliteTodosOptions(options);
    this.store = new SqliteTodoStore(resolved.dbPath);
  }

  register(api: PluginApi): void {
    for (const tool of createTodoTools(this.store)) {
      api.registerTool(tool);
    }
  }
}
