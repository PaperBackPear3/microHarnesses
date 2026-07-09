import path from "node:path";

export interface SqliteTodosPluginOptions {
  dbPath?: string;
}

export interface ResolvedSqliteTodosPluginOptions {
  dbPath: string;
}

export function resolveSqliteTodosOptions(
  options: SqliteTodosPluginOptions = {},
): ResolvedSqliteTodosPluginOptions {
  return {
    dbPath: path.resolve(options.dbPath ?? path.join(process.cwd(), ".micro-harness", "todos.sqlite")),
  };
}
