import { rootContext } from "./ids";
import { NoopSpan } from "./span";
import { HeuristicTokenCounter } from "./tokenCounter";
import type {
  Attributes,
  Counter,
  Histogram,
  Logger,
  Meter,
  ObservabilityProvider,
  Sampler,
  Span,
  StartSpanOptions,
  Tracer,
  UpDownCounter,
} from "./types";

const noopCounter: Counter = { add() {} };
const noopUpDown: UpDownCounter = { add() {}, record() {} };
const noopHistogram: Histogram = { record() {} };

class NoopTracer implements Tracer {
  startSpan(name: string, options: StartSpanOptions): Span {
    const parent = options.parent
      ? "context" in options.parent
        ? options.parent.context
        : options.parent
      : rootContext();
    return new NoopSpan(parent, name, options.kind);
  }
}

class NoopMeter implements Meter {
  createCounter(): Counter {
    return noopCounter;
  }
  createUpDownCounter(): UpDownCounter {
    return noopUpDown;
  }
  createHistogram(): Histogram {
    return noopHistogram;
  }
}

class NoopLogger implements Logger {
  log(): void {}
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

class NoopSampler implements Sampler {
  shouldSample(): boolean {
    return false;
  }
}

/**
 * Zero-overhead {@link ObservabilityProvider}. Every signal is dropped; used
 * when observability is disabled so the runtime hot path pays nothing.
 */
export class NoopObservabilityProvider implements ObservabilityProvider {
  readonly tracer: Tracer = new NoopTracer();
  readonly meter: Meter = new NoopMeter();
  readonly logger: Logger = new NoopLogger();
  readonly stream = undefined;
  readonly tokenCounter = new HeuristicTokenCounter();
  readonly contextWindowTokens = 0;
  readonly sampler: Sampler = new NoopSampler();

  redact(_attributes: Attributes, _content?: boolean): Attributes {
    return {};
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}
