import type {
  LogExporter,
  LogRecord,
  MetricExporter,
  MetricRecord,
  ReadableSpan,
  TraceExporter,
} from "./types";

export interface ConsoleExporterOptions {
  /** Destination for lines. Defaults to `process.stderr.write`. */
  write?(line: string): void;
  /** When true, emit one JSON object per line; otherwise a compact summary. */
  json?: boolean;
}

/** Writes spans, metrics, and logs to a stream (stderr by default). */
export class ConsoleObservabilityExporter implements TraceExporter, MetricExporter, LogExporter {
  private readonly write: (line: string) => void;
  private readonly json: boolean;

  constructor(options: ConsoleExporterOptions = {}) {
    this.write = options.write ?? ((line) => void process.stderr.write(line));
    this.json = options.json ?? false;
  }

  export(items: ReadableSpan[] | MetricRecord[] | LogRecord[]): void {
    for (const item of items) {
      this.write(`${this.format(item)}\n`);
    }
  }

  private format(item: ReadableSpan | MetricRecord | LogRecord): string {
    if (this.json) {
      return JSON.stringify(item);
    }
    if (isSpan(item)) {
      const status = item.status.code === "error" ? " ERROR" : "";
      return `[span] ${item.kind}:${item.name} ${item.durationMs}ms${status}`;
    }
    if (isMetric(item)) {
      return `[metric] ${item.name}=${item.value} ${JSON.stringify(item.attributes)}`;
    }
    return `[log:${item.level}] ${item.message}`;
  }
}

function isSpan(item: ReadableSpan | MetricRecord | LogRecord): item is ReadableSpan {
  return "kind" in item && "context" in item && "durationMs" in item;
}

function isMetric(item: ReadableSpan | MetricRecord | LogRecord): item is MetricRecord {
  return "kind" in item && "value" in item && !("context" in item);
}
