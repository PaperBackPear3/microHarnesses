import type {
  Attributes,
  Counter,
  Histogram,
  Meter,
  MetricInstrumentOptions,
  MetricKind,
  MetricRecord,
  UpDownCounter,
} from "./types";

export interface DefaultMeterOptions {
  /** Invoked with each recorded measurement. */
  onRecord(record: MetricRecord): void;
}

function record(
  onRecord: (record: MetricRecord) => void,
  name: string,
  kind: MetricKind,
  value: number,
  attributes: Attributes | undefined,
  options?: MetricInstrumentOptions,
): void {
  onRecord({
    name,
    kind,
    value,
    timestamp: new Date().toISOString(),
    attributes: attributes ?? {},
    ...(options?.unit ? { unit: options.unit } : {}),
    ...(options?.description ? { description: options.description } : {}),
  });
}

/**
 * Zero-dependency {@link Meter}. Each measurement is streamed to `onRecord`;
 * aggregation (sum/histogram bucketing) is the exporter's responsibility, which
 * keeps core simple and lets OTel/Prometheus exporters aggregate their own way.
 */
export class DefaultMeter implements Meter {
  private readonly onRecord: (record: MetricRecord) => void;

  constructor(options: DefaultMeterOptions) {
    this.onRecord = options.onRecord;
  }

  createCounter(name: string, options?: MetricInstrumentOptions): Counter {
    return {
      add: (value, attributes) =>
        record(this.onRecord, name, "counter", value, attributes, options),
    };
  }

  createUpDownCounter(name: string, options?: MetricInstrumentOptions): UpDownCounter {
    return {
      add: (value, attributes) =>
        record(this.onRecord, name, "up_down_counter", value, attributes, options),
      record: (value, attributes) =>
        record(this.onRecord, name, "up_down_counter", value, attributes, options),
    };
  }

  createHistogram(name: string, options?: MetricInstrumentOptions): Histogram {
    return {
      record: (value, attributes) =>
        record(this.onRecord, name, "histogram", value, attributes, options),
    };
  }
}
