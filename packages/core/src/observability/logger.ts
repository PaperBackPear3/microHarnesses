import type { Attributes, LogLevel, LogRecord, Logger, TraceContext } from "./types";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

export interface DefaultLoggerOptions {
  minLevel: LogLevel;
  /** Invoked with each record at or above `minLevel`. */
  onRecord(record: LogRecord): void;
}

/** Zero-dependency structured {@link Logger} with level filtering. */
export class DefaultLogger implements Logger {
  private readonly minLevel: number;
  private readonly onRecord: (record: LogRecord) => void;

  constructor(options: DefaultLoggerOptions) {
    this.minLevel = LEVEL_ORDER[options.minLevel];
    this.onRecord = options.onRecord;
  }

  log(record: Omit<LogRecord, "timestamp"> & { timestamp?: string }): void {
    if (LEVEL_ORDER[record.level] < this.minLevel) return;
    this.onRecord({
      level: record.level,
      message: record.message,
      timestamp: record.timestamp ?? new Date().toISOString(),
      ...(record.attributes ? { attributes: record.attributes } : {}),
      ...(record.traceContext ? { traceContext: record.traceContext } : {}),
    });
  }

  trace(message: string, attributes?: Attributes, traceContext?: TraceContext): void {
    this.emit("trace", message, attributes, traceContext);
  }
  debug(message: string, attributes?: Attributes, traceContext?: TraceContext): void {
    this.emit("debug", message, attributes, traceContext);
  }
  info(message: string, attributes?: Attributes, traceContext?: TraceContext): void {
    this.emit("info", message, attributes, traceContext);
  }
  warn(message: string, attributes?: Attributes, traceContext?: TraceContext): void {
    this.emit("warn", message, attributes, traceContext);
  }
  error(message: string, attributes?: Attributes, traceContext?: TraceContext): void {
    this.emit("error", message, attributes, traceContext);
  }

  private emit(
    level: LogLevel,
    message: string,
    attributes?: Attributes,
    traceContext?: TraceContext,
  ): void {
    this.log({
      level,
      message,
      ...(attributes ? { attributes } : {}),
      ...(traceContext ? { traceContext } : {}),
    });
  }
}
