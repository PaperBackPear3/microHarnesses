import { type Server, createServer } from "node:http";
import type { MetricExporter, MetricRecord } from "@micro-harnesses/core";
import type { OtelExporterConfig } from "../config";
import { MetricAggregator } from "./aggregator";

export class PrometheusMetricExporter implements MetricExporter {
  private readonly port: number;
  private readonly endpoint: string;
  private readonly aggregator = new MetricAggregator();
  private server?: Server;

  constructor(config: OtelExporterConfig = {}) {
    this.port = config.metrics?.mode === "prometheus" ? (config.metrics.port ?? 9464) : 9464;
    this.endpoint =
      config.metrics?.mode === "prometheus" ? (config.metrics.endpoint ?? "/metrics") : "/metrics";
  }

  export(metrics: MetricRecord[]): void {
    this.aggregator.record(metrics);
    this.ensureServer();
  }

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
    this.server = undefined;
  }

  private ensureServer(): void {
    if (this.server) return;
    this.server = createServer((req, res) => {
      if (req.url !== this.endpoint) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const lines = this.renderMetrics();
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
      res.end(lines.join("\n"));
    });
    this.server.listen(this.port);
    this.server.unref?.();
  }

  private renderMetrics(): string[] {
    const snapshot = this.aggregator.snapshot();
    const lines: string[] = [];
    for (const metric of snapshot) {
      const base = sanitizeMetricName(metric.name);
      const labels = renderLabels(metric.attributes);
      if (metric.kind === "histogram") {
        lines.push(`# TYPE ${base} summary`);
        lines.push(`${base}_sum${labels} ${metric.sum}`);
        lines.push(`${base}_count${labels} ${metric.count}`);
        lines.push(`${base}_min${labels} ${metric.min}`);
        lines.push(`${base}_max${labels} ${metric.max}`);
      } else {
        lines.push(`# TYPE ${base} ${metric.kind === "up_down_counter" ? "gauge" : "counter"}`);
        const value = metric.kind === "counter" ? metric.sum : metric.last;
        lines.push(`${base}${labels} ${value}`);
      }
    }
    return lines;
  }
}

function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, "_");
}

function renderLabels(attributes: Record<string, unknown>): string {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return "";
  return `{${entries
    .map(([key, value]) => `${sanitizeMetricName(key)}="${String(value).replaceAll('"', '\\"')}"`)
    .join(",")}}`;
}
