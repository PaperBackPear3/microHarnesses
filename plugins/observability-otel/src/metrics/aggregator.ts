import type { MetricKind, MetricRecord } from "@micro-harnesses/core";

interface AggregateBase {
  name: string;
  kind: MetricKind;
  attributes: Record<string, unknown>;
  unit?: string;
  description?: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  last: number;
  timestamp: string;
}

export interface AggregatedMetric extends AggregateBase {}

export class MetricAggregator {
  private readonly items = new Map<string, AggregateBase>();

  record(metrics: MetricRecord[]): void {
    for (const metric of metrics) {
      const key = `${metric.name}|${JSON.stringify(metric.attributes)}`;
      const existing = this.items.get(key);
      if (!existing) {
        this.items.set(key, {
          name: metric.name,
          kind: metric.kind,
          attributes: metric.attributes,
          unit: metric.unit,
          description: metric.description,
          count: 1,
          sum: metric.value,
          min: metric.value,
          max: metric.value,
          last: metric.value,
          timestamp: metric.timestamp,
        });
        continue;
      }
      existing.count += 1;
      existing.sum += metric.value;
      existing.min = Math.min(existing.min, metric.value);
      existing.max = Math.max(existing.max, metric.value);
      existing.last = metric.value;
      existing.timestamp = metric.timestamp;
    }
  }

  drain(): AggregatedMetric[] {
    const values = [...this.items.values()];
    this.items.clear();
    return values;
  }

  snapshot(): AggregatedMetric[] {
    return [...this.items.values()];
  }
}
