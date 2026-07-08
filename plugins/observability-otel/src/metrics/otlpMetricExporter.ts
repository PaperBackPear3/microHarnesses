import type { MetricExporter, MetricRecord } from "@micro-harnesses/core";
import type { OtelExporterConfig } from "../config";
import { resolveHeaders, resolveSignalEndpoint } from "../config";
import { postJson } from "../transport";
import { MetricAggregator } from "./aggregator";

export class OtlpMetricExporter implements MetricExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly aggregator = new MetricAggregator();
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private inFlight = Promise.resolve();
  private readonly temporality: "cumulative" | "delta";

  constructor(config: OtelExporterConfig = {}) {
    this.endpoint = resolveSignalEndpoint(config, "metrics");
    this.headers = resolveHeaders(config);
    this.intervalMs = Math.max(
      100,
      config.metrics?.mode === "otlp" ? (config.metrics.exportIntervalMillis ?? 2000) : 2000,
    );
    this.temporality =
      config.metrics?.mode === "otlp" ? (config.metrics.temporality ?? "cumulative") : "cumulative";
  }

  export(metrics: MetricRecord[]): void {
    this.aggregator.record(metrics);
    this.ensureTimer();
  }

  async forceFlush(): Promise<void> {
    await this.enqueueFlush();
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.enqueueFlush();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.forceFlush();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private async enqueueFlush(): Promise<void> {
    this.inFlight = this.inFlight
      .then(async () => {
        const aggregates = this.aggregator.drain();
        if (aggregates.length === 0) return;
        await postJson(
          this.endpoint,
          {
            temporality: this.temporality,
            resourceMetrics: [
              {
                scopeMetrics: [
                  {
                    metrics: aggregates.map((metric) => ({
                      name: metric.name,
                      kind: metric.kind,
                      attributes: metric.attributes,
                      unit: metric.unit,
                      description: metric.description,
                      count: metric.count,
                      sum: metric.sum,
                      min: metric.min,
                      max: metric.max,
                      last: metric.last,
                      timeUnixNano: isoToUnixNano(metric.timestamp),
                    })),
                  },
                ],
              },
            ],
          },
          this.headers,
        );
      })
      .catch(() => undefined);
    await this.inFlight;
  }
}

function isoToUnixNano(iso: string): string {
  const millis = Date.parse(iso);
  return (BigInt(millis) * 1_000_000n).toString();
}
