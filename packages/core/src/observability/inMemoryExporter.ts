import type {
  LogExporter,
  LogRecord,
  MetricExporter,
  MetricRecord,
  ReadableSpan,
  TraceExporter,
} from "./types";

/**
 * Captures spans, metrics, and logs in memory. Primarily for tests and for
 * surfacing recent telemetry in tooling (e.g. `sessions show`).
 */
export class InMemoryObservabilityExporter implements TraceExporter, MetricExporter, LogExporter {
  private readonly spans: ReadableSpan[] = [];
  private readonly metrics: MetricRecord[] = [];
  private readonly logs: LogRecord[] = [];

  export(items: ReadableSpan[] | MetricRecord[] | LogRecord[]): void {
    for (const item of items) {
      if (isSpan(item)) {
        this.spans.push(item);
      } else if (isMetric(item)) {
        this.metrics.push(item);
      } else {
        this.logs.push(item);
      }
    }
  }

  getSpans(): ReadableSpan[] {
    return [...this.spans];
  }

  getMetrics(): MetricRecord[] {
    return [...this.metrics];
  }

  getLogs(): LogRecord[] {
    return [...this.logs];
  }

  reset(): void {
    this.spans.length = 0;
    this.metrics.length = 0;
    this.logs.length = 0;
  }
}

function isSpan(item: ReadableSpan | MetricRecord | LogRecord): item is ReadableSpan {
  return "kind" in item && "context" in item && "durationMs" in item;
}

function isMetric(item: ReadableSpan | MetricRecord | LogRecord): item is MetricRecord {
  return "kind" in item && "value" in item && !("context" in item);
}
