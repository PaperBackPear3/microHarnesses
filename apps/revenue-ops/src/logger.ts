const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

const MIN_LEVEL: LogLevel = (process.env.REVENUE_OPS_LOG_LEVEL as LogLevel | undefined) ?? "info";

function ts(): string {
  return new Date().toISOString();
}

export function log(level: LogLevel, tag: string, message: string, extra?: unknown): void {
  if (LEVELS[level] < LEVELS[MIN_LEVEL]) return;
  const line = `[${ts()}] [${level.toUpperCase().padEnd(5)}] [${tag}] ${message}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  if (extra !== undefined) {
    out(line, extra);
  } else {
    out(line);
  }
}
