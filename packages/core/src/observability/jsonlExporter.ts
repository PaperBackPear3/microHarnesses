import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type {
  LogExporter,
  LogRecord,
  MetricExporter,
  MetricRecord,
  ReadableSpan,
  TraceExporter,
} from "./types";

export interface JsonlExporterOptions {
  /** Directory that will hold spans.jsonl / metrics.jsonl / logs.jsonl. */
  dir: string;
  spansFile?: string;
  metricsFile?: string;
  logsFile?: string;
}

/**
 * Appends spans, metrics, and logs as newline-delimited JSON under a directory.
 * Preserves a machine-readable shape for local debugging and durable audit.
 */
export class JsonlObservabilityExporter implements TraceExporter, MetricExporter, LogExporter {
  private readonly dir: string;
  private readonly spansPath: string;
  private readonly metricsPath: string;
  private readonly logsPath: string;
  private ensured = false;

  constructor(options: JsonlExporterOptions) {
    this.dir = options.dir;
    this.spansPath = path.join(options.dir, options.spansFile ?? "spans.jsonl");
    this.metricsPath = path.join(options.dir, options.metricsFile ?? "metrics.jsonl");
    this.logsPath = path.join(options.dir, options.logsFile ?? "logs.jsonl");
  }

  async export(items: ReadableSpan[] | MetricRecord[] | LogRecord[]): Promise<void> {
    await this.ensureDir();
    const buckets = new Map<string, string[]>();
    for (const item of items) {
      const target = isSpan(item)
        ? this.spansPath
        : isMetric(item)
          ? this.metricsPath
          : this.logsPath;
      const lines = buckets.get(target) ?? [];
      lines.push(JSON.stringify(item));
      buckets.set(target, lines);
    }
    await Promise.all(
      [...buckets.entries()].map(([target, lines]) =>
        appendFile(target, `${lines.join("\n")}\n`, "utf8"),
      ),
    );
  }

  private async ensureDir(): Promise<void> {
    if (this.ensured) return;
    await mkdir(this.dir, { recursive: true });
    this.ensured = true;
  }
}

function isSpan(item: ReadableSpan | MetricRecord | LogRecord): item is ReadableSpan {
  return "kind" in item && "context" in item && "durationMs" in item;
}

function isMetric(item: ReadableSpan | MetricRecord | LogRecord): item is MetricRecord {
  return "kind" in item && "value" in item && !("context" in item);
}
