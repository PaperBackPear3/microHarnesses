import path from "node:path";

export interface SqliteTodosPluginOptions {
  sessionsDir?: string;
}

export interface ResolvedSqliteTodosPluginOptions {
  sessionsDir: string;
}

export function resolveSqliteTodosOptions(
  options: SqliteTodosPluginOptions = {},
): ResolvedSqliteTodosPluginOptions {
  return {
    sessionsDir: path.resolve(options.sessionsDir ?? path.join(process.cwd(), ".micro-harness", "sessions")),
  };
}
