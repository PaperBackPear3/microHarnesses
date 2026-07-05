/**
 * Observability contracts for the core runtime.
 *
 * The model is intentionally OpenTelemetry-*shaped* (W3C trace/span ids; the
 * traces + metrics + logs pillars; OTel-compatible attribute values) so that a
 * concrete OpenTelemetry exporter can later be shipped as a thin adapter plugin
 * without touching core. Core itself stays zero-dependency: it defines these
 * interfaces and ships in-memory / no-op / console / jsonl defaults only.
 */

/** OTel-compatible attribute value. */
export type AttributeValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string>
  | ReadonlyArray<number>
  | ReadonlyArray<boolean>;

export type Attributes = Record<string, AttributeValue>;

/** W3C-style trace correlation identifiers. */
export interface TraceContext {
  /** 16-byte trace id, lowercase hex (32 chars). */
  traceId: string;
  /** 8-byte span id, lowercase hex (16 chars). */
  spanId: string;
  /** Parent span id, when this span is a child. */
  parentSpanId?: string;
}

/** The kind of unit of work a span represents. */
export type SpanKind =
  | "run"
  | "iteration"
  | "model"
  | "tool"
  | "skill"
  | "context"
  | "policy"
  | "approval"
  | "subagent";

export type SpanStatusCode = "unset" | "ok" | "error";

export interface SpanStatus {
  code: SpanStatusCode;
  message?: string;
}

/** A timestamped event recorded on a span (e.g. a streamed delta, a decision). */
export interface SpanEventRecord {
  name: string;
  timestamp: string;
  attributes?: Attributes;
}

export interface SpanException {
  message: string;
  name?: string;
  stack?: string;
  /** Runtime error taxonomy (see {@link ErrorCategory}). */
  category?: ErrorCategory;
}

/** Live, mutable span handle handed to instrumentation code. */
export interface Span {
  readonly context: TraceContext;
  readonly kind: SpanKind;
  readonly name: string;
  setAttribute(key: string, value: AttributeValue): this;
  setAttributes(attributes: Attributes): this;
  addEvent(name: string, attributes?: Attributes): this;
  setStatus(status: SpanStatus): this;
  recordException(error: unknown, category?: ErrorCategory): this;
  /** Ends the span. Repeated calls are no-ops. */
  end(endTime?: string): void;
  readonly ended: boolean;
}

/** Immutable snapshot of a finished span, handed to exporters. */
export interface ReadableSpan {
  context: TraceContext;
  name: string;
  kind: SpanKind;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: SpanStatus;
  attributes: Attributes;
  events: SpanEventRecord[];
  exceptions: SpanException[];
  resource: Attributes;
}

export interface StartSpanOptions {
  kind: SpanKind;
  /** Parent span or bare trace context for linking; omit for a new root trace. */
  parent?: Span | TraceContext;
  attributes?: Attributes;
  startTime?: string;
}

export interface Tracer {
  startSpan(name: string, options: StartSpanOptions): Span;
}

/** Receives finished spans for export/aggregation. */
export interface TraceExporter {
  export(spans: ReadableSpan[]): Promise<void> | void;
  shutdown?(): Promise<void> | void;
  forceFlush?(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type MetricKind = "counter" | "up_down_counter" | "histogram";

export interface MetricInstrumentOptions {
  description?: string;
  unit?: string;
}

export interface Counter {
  add(value: number, attributes?: Attributes): void;
}

/** A gauge-like instrument that can move up or down. */
export interface UpDownCounter {
  add(value: number, attributes?: Attributes): void;
  record(value: number, attributes?: Attributes): void;
}

export interface Histogram {
  record(value: number, attributes?: Attributes): void;
}

export interface Meter {
  createCounter(name: string, options?: MetricInstrumentOptions): Counter;
  createUpDownCounter(name: string, options?: MetricInstrumentOptions): UpDownCounter;
  createHistogram(name: string, options?: MetricInstrumentOptions): Histogram;
}

/** A recorded metric measurement, handed to exporters. */
export interface MetricRecord {
  name: string;
  kind: MetricKind;
  value: number;
  timestamp: string;
  attributes: Attributes;
  unit?: string;
  description?: string;
}

export interface MetricExporter {
  export(metrics: MetricRecord[]): Promise<void> | void;
  shutdown?(): Promise<void> | void;
  forceFlush?(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: string;
  attributes?: Attributes;
  traceContext?: TraceContext;
}

export interface Logger {
  log(record: Omit<LogRecord, "timestamp"> & { timestamp?: string }): void;
  trace(message: string, attributes?: Attributes, traceContext?: TraceContext): void;
  debug(message: string, attributes?: Attributes, traceContext?: TraceContext): void;
  info(message: string, attributes?: Attributes, traceContext?: TraceContext): void;
  warn(message: string, attributes?: Attributes, traceContext?: TraceContext): void;
  error(message: string, attributes?: Attributes, traceContext?: TraceContext): void;
}

export interface LogExporter {
  export(records: LogRecord[]): Promise<void> | void;
  shutdown?(): Promise<void> | void;
  forceFlush?(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

export interface SamplingInput {
  traceId: string;
  name: string;
  kind: SpanKind;
}

export interface Sampler {
  shouldSample(input: SamplingInput): boolean;
}

// ---------------------------------------------------------------------------
// Redaction / content capture
// ---------------------------------------------------------------------------

export interface RedactionPolicy {
  /** When false, prompt/reasoning/tool payload attributes are dropped entirely. */
  captureContent: boolean;
  /**
   * Privacy mode: when true, content is dropped exactly like `captureContent:
   * false` regardless of the flag, and content span events are suppressed.
   */
  privacyMode: boolean;
  /** Attribute string values longer than this are truncated. */
  maxValueLength: number;
  /** Attribute keys whose values are always replaced with `[REDACTED]`. */
  denyKeys: string[];
}

/**
 * Redacts an attribute bag according to a {@link RedactionPolicy}. `content`
 * marks the bag as sensitive payload (prompt/reasoning/tool input-output) that
 * is dropped when capture is disabled.
 */
export type AttributeRedactor = (attributes: Attributes, content?: boolean) => Attributes;

// ---------------------------------------------------------------------------
// Token accounting (context-window metrics)
// ---------------------------------------------------------------------------

/** Estimates token counts for context-window utilization metrics. */
export interface TokenCounter {
  count(text: string): number;
}

// ---------------------------------------------------------------------------
// Live streaming (latency-sensitive UI channel)
// ---------------------------------------------------------------------------

export type StreamEventType =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "model.selected"
  | "model.thinking_started"
  | "model.thinking_completed"
  | "model.reasoning_delta"
  | "model.reasoning_completed"
  | "model.output_delta"
  | "model.output_completed"
  | "model.usage"
  | "tool.started"
  | "tool.completed"
  | "tool.blocked"
  | "tool.approval_requested"
  | "tool.approval_resolved"
  | "context.window"
  | "limit.reached";

export interface StreamEvent {
  type: StreamEventType;
  timestamp: string;
  runId: string;
  sessionId?: string;
  traceId?: string;
  spanId?: string;
  payload: Record<string, unknown>;
}

/**
 * Latency-sensitive UI channel for progress rendering (spinners, streamed
 * deltas, tool-call lines). High-frequency deltas flow here and as span events,
 * but are NOT persisted per-token. Replaces the UI role of the old EventSink.
 */
export interface StreamSink {
  push(event: StreamEvent): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | "unknown_tool"
  | "policy"
  | "approval_denied"
  | "out_of_scope"
  | "malformed_args"
  | "tool_error"
  | "timeout"
  | "killed"
  | "limit_reached"
  | "model_error"
  | "run_failed";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Umbrella handed to the runtime and to instrumentation code. */
export interface ObservabilityProvider {
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly logger: Logger;
  readonly stream?: StreamSink;
  readonly tokenCounter: TokenCounter;
  readonly redact: AttributeRedactor;
  /** Configured max context window in tokens for utilization metrics. */
  readonly contextWindowTokens: number;
  /** Sampler consulted before a new root trace is created. */
  readonly sampler: Sampler;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ObservabilityResource {
  serviceName: string;
  serviceVersion?: string;
  attributes?: Attributes;
}

export interface ObservabilityConfig {
  /** When false, a zero-overhead no-op provider is returned. */
  enabled?: boolean;
  resource?: ObservabilityResource;
  sampler?: Sampler;
  traceExporters?: TraceExporter[];
  metricExporters?: MetricExporter[];
  logExporters?: LogExporter[];
  stream?: StreamSink;
  redaction?: Partial<RedactionPolicy>;
  tokenCounter?: TokenCounter;
  /** Max context window in tokens for utilization metrics (default 128000). */
  contextWindowTokens?: number;
  /** Minimum level a log record must meet to be exported (default "info"). */
  logLevel?: LogLevel;
}
