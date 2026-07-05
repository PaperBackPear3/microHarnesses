import { childContext, rootContext } from "./ids";
import { MutableSpan, NoopSpan } from "./span";
import type {
  Attributes,
  ReadableSpan,
  Sampler,
  Span,
  StartSpanOptions,
  TraceContext,
  Tracer,
} from "./types";

export interface DefaultTracerOptions {
  sampler: Sampler;
  resource: Attributes;
  /** Invoked with each finished, sampled span. */
  onSpanEnd(span: ReadableSpan): void;
}

/**
 * Zero-dependency {@link Tracer}. Sampling is decided per span from its trace
 * id, which is deterministic and therefore consistent across a whole trace
 * (parent and children agree). Unsampled spans become {@link NoopSpan}s that
 * still carry a propagatable context.
 */
export class DefaultTracer implements Tracer {
  private readonly sampler: Sampler;
  private readonly resource: Attributes;
  private readonly onSpanEnd: (span: ReadableSpan) => void;

  constructor(options: DefaultTracerOptions) {
    this.sampler = options.sampler;
    this.resource = options.resource;
    this.onSpanEnd = options.onSpanEnd;
  }

  startSpan(name: string, options: StartSpanOptions): Span {
    const context = this.resolveContext(options.parent);
    if (!this.sampler.shouldSample({ traceId: context.traceId, name, kind: options.kind })) {
      return new NoopSpan(context, name, options.kind);
    }
    return new MutableSpan({
      context,
      name,
      kind: options.kind,
      startTime: options.startTime ?? new Date().toISOString(),
      resource: this.resource,
      ...(options.attributes ? { attributes: options.attributes } : {}),
      onEnd: this.onSpanEnd,
    });
  }

  private resolveContext(parent?: Span | TraceContext): TraceContext {
    if (!parent) return rootContext();
    const parentContext = "context" in parent ? parent.context : parent;
    return childContext(parentContext);
  }
}
