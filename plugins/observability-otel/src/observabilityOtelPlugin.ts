import type { HarnessPlugin, PluginApi, PluginCapability } from "@micro-harnesses/core";
import type { OtelExporterConfig } from "./config";
import { OtlpLogExporter } from "./logs/otlpLogExporter";
import { OtlpMetricExporter } from "./metrics/otlpMetricExporter";
import { PrometheusMetricExporter } from "./metrics/prometheusExporter";
import { OtlpTraceExporter } from "./trace/otlpTraceExporter";

export class ObservabilityOtelPlugin implements HarnessPlugin {
  readonly name = "observability-otel-plugin";
  readonly capabilities: PluginCapability[] = ["observability"];
  constructor(private readonly config: OtelExporterConfig = {}) {}

  register(api: PluginApi): void {
    if (this.config.traces?.enabled !== false) {
      api.observability.registerTraceExporter(new OtlpTraceExporter(this.config));
    }
    if (this.config.metrics?.enabled !== false) {
      api.observability.registerMetricExporter(createMetricExporter(this.config));
    }
    if (this.config.logs?.enabled !== false) {
      api.observability.registerLogExporter(new OtlpLogExporter(this.config));
    }
  }
}

export function createMetricExporter(config: OtelExporterConfig) {
  if (config.metrics?.mode === "prometheus") {
    return new PrometheusMetricExporter(config);
  }
  return new OtlpMetricExporter(config);
}
