import type {
  AttributeValue,
  Attributes,
  ErrorCategory,
  ReadableSpan,
  Span,
  SpanEventRecord,
  SpanException,
  SpanKind,
  SpanStatus,
  TraceContext,
} from "./types";

export interface MutableSpanOptions {
  context: TraceContext;
  name: string;
  kind: SpanKind;
  startTime: string;
  resource: Attributes;
  attributes?: Attributes;
  onEnd(span: ReadableSpan): void;
}

/** Concrete, recording {@link Span}. Handed to instrumentation code. */
export class MutableSpan implements Span {
  readonly context: TraceContext;
  readonly kind: SpanKind;
  readonly name: string;
  private readonly startTime: string;
  private readonly resource: Attributes;
  private readonly attributes: Attributes;
  private readonly events: SpanEventRecord[] = [];
  private readonly exceptions: SpanException[] = [];
  private status: SpanStatus = { code: "unset" };
  private readonly onEnd: (span: ReadableSpan) => void;
  private isEnded = false;

  constructor(options: MutableSpanOptions) {
    this.context = options.context;
    this.name = options.name;
    this.kind = options.kind;
    this.startTime = options.startTime;
    this.resource = options.resource;
    this.attributes = { ...(options.attributes ?? {}) };
    this.onEnd = options.onEnd;
  }

  get ended(): boolean {
    return this.isEnded;
  }

  setAttribute(key: string, value: AttributeValue): this {
    if (this.isEnded) return this;
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: Attributes): this {
    if (this.isEnded) return this;
    Object.assign(this.attributes, attributes);
    return this;
  }

  addEvent(name: string, attributes?: Attributes): this {
    if (this.isEnded) return this;
    this.events.push({
      name,
      timestamp: new Date().toISOString(),
      ...(attributes ? { attributes } : {}),
    });
    return this;
  }

  setStatus(status: SpanStatus): this {
    if (this.isEnded) return this;
    this.status = status;
    return this;
  }

  recordException(error: unknown, category?: ErrorCategory): this {
    if (this.isEnded) return this;
    const exception: SpanException =
      error instanceof Error
        ? {
            message: error.message,
            name: error.name,
            ...(error.stack ? { stack: error.stack } : {}),
            ...(category ? { category } : {}),
          }
        : { message: String(error), ...(category ? { category } : {}) };
    this.exceptions.push(exception);
    if (this.status.code !== "error") {
      this.status = { code: "error", message: exception.message };
    }
    return this;
  }

  end(endTime?: string): void {
    if (this.isEnded) return;
    this.isEnded = true;
    const end = endTime ?? new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(end) - Date.parse(this.startTime));
    const readable: ReadableSpan = {
      context: this.context,
      name: this.name,
      kind: this.kind,
      startTime: this.startTime,
      endTime: end,
      durationMs,
      status: this.status,
      attributes: this.attributes,
      events: this.events,
      exceptions: this.exceptions,
      resource: this.resource,
    };
    this.onEnd(readable);
  }
}

/**
 * A non-recording span that still carries a valid trace context so unsampled
 * traces can propagate correlation ids and stream events without allocating or
 * exporting span data.
 */
export class NoopSpan implements Span {
  readonly context: TraceContext;
  readonly kind: SpanKind;
  readonly name: string;
  readonly ended = false;

  constructor(context: TraceContext, name: string, kind: SpanKind) {
    this.context = context;
    this.name = name;
    this.kind = kind;
  }

  setAttribute(): this {
    return this;
  }
  setAttributes(): this {
    return this;
  }
  addEvent(): this {
    return this;
  }
  setStatus(): this {
    return this;
  }
  recordException(): this {
    return this;
  }
  end(): void {}
}
