import { DefaultLogger } from "./logger";
import { DefaultMeter } from "./metrics";
import { NoopObservabilityProvider } from "./noop";
import { createRedactor, resolveRedactionPolicy } from "./redaction";
import { AlwaysOnSampler } from "./sampler";
import { HeuristicTokenCounter } from "./tokenCounter";
import { DefaultTracer } from "./tracer";
import type {
  AttributeRedactor,
  Attributes,
  LogExporter,
  LogRecord,
  Logger,
  Meter,
  MetricExporter,
  MetricRecord,
  ObservabilityConfig,
  ObservabilityProvider,
  ReadableSpan,
  Sampler,
  StreamSink,
  TokenCounter,
  TraceExporter,
  Tracer,
} from "./types";

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;

/**
 * Fans finished spans / recorded metrics / log records out to their exporters,
 * tracking in-flight async exports so {@link forceFlush} can await them.
 */
export class DefaultObservabilityProvider implements ObservabilityProvider {
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly logger: Logger;
  readonly stream?: StreamSink;
  readonly tokenCounter: TokenCounter;
  readonly redact: AttributeRedactor;
  readonly contextWindowTokens: number;
  readonly sampler: Sampler;

  private readonly traceExporters: TraceExporter[];
  private readonly metricExporters: MetricExporter[];
  private readonly logExporters: LogExporter[];
  private readonly pending = new Set<Promise<unknown>>();

  constructor(config: ObservabilityConfig) {
    const resource = buildResource(config);
    this.sampler = config.sampler ?? new AlwaysOnSampler();
    this.tokenCounter = config.tokenCounter ?? new HeuristicTokenCounter();
    this.contextWindowTokens = config.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    this.redact = createRedactor(resolveRedactionPolicy(config.redaction));
    this.stream = config.stream;
    this.traceExporters = config.traceExporters ?? [];
    this.metricExporters = config.metricExporters ?? [];
    this.logExporters = config.logExporters ?? [];

    this.tracer = new DefaultTracer({
      sampler: this.sampler,
      resource,
      onSpanEnd: (span) => this.exportSpan(span),
    });
    this.meter = new DefaultMeter({ onRecord: (record) => this.exportMetric(record) });
    this.logger = new DefaultLogger({
      minLevel: config.logLevel ?? "info",
      onRecord: (record) => this.exportLog(record),
    });
  }

  private exportSpan(span: ReadableSpan): void {
    for (const exporter of this.traceExporters) {
      this.track(exporter.export([span]));
    }
  }

  /** Appends a trace exporter (e.g. registered by a plugin at composition time). */
  addTraceExporter(exporter: TraceExporter): void {
    this.traceExporters.push(exporter);
  }

  /** Appends a metric exporter. */
  addMetricExporter(exporter: MetricExporter): void {
    this.metricExporters.push(exporter);
  }

  /** Appends a log exporter. */
  addLogExporter(exporter: LogExporter): void {
    this.logExporters.push(exporter);
  }

  private exportMetric(record: MetricRecord): void {
    for (const exporter of this.metricExporters) {
      this.track(exporter.export([record]));
    }
  }

  private exportLog(record: LogRecord): void {
    for (const exporter of this.logExporters) {
      this.track(exporter.export([record]));
    }
  }

  private track(result: unknown): void {
    if (result instanceof Promise) {
      this.pending.add(result);
      result.finally(() => this.pending.delete(result)).catch(() => {});
    }
  }

  async forceFlush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
    await Promise.allSettled([
      ...this.traceExporters.map((e) => e.forceFlush?.()),
      ...this.metricExporters.map((e) => e.forceFlush?.()),
      ...this.logExporters.map((e) => e.forceFlush?.()),
    ]);
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
    await Promise.allSettled([
      ...this.traceExporters.map((e) => e.shutdown?.()),
      ...this.metricExporters.map((e) => e.shutdown?.()),
      ...this.logExporters.map((e) => e.shutdown?.()),
    ]);
  }
}

function buildResource(config: ObservabilityConfig): Attributes {
  const resource: Attributes = {
    "service.name": config.resource?.serviceName ?? "micro-harness",
  };
  if (config.resource?.serviceVersion) {
    resource["service.version"] = config.resource.serviceVersion;
  }
  Object.assign(resource, config.resource?.attributes ?? {});
  return resource;
}

/**
 * Builds an {@link ObservabilityProvider}. Returns a zero-overhead no-op
 * provider when `enabled` is false (the default is enabled).
 */
export function createObservability(config: ObservabilityConfig = {}): ObservabilityProvider {
  if (config.enabled === false) {
    return new NoopObservabilityProvider();
  }
  return new DefaultObservabilityProvider(config);
}
