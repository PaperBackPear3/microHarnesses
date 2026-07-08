# @micro-harnesses/plugin-observability-otel

OTLP/Prometheus exporter plugin for `@micro-harnesses/core`.

It registers trace/metric/log exporters through the core `"observability"` plugin capability.

## Install

```bash
npm install @micro-harnesses/plugin-observability-otel
```

## Usage

```ts
import { PluginHost } from "@micro-harnesses/core";
import { ObservabilityOtelPlugin } from "@micro-harnesses/plugin-observability-otel";

await pluginHost.register([
  new ObservabilityOtelPlugin({
    endpoint: "http://127.0.0.1:4318",
    metrics: { mode: "otlp", exportIntervalMillis: 2000 },
  }),
]);
```

## Config

```ts
interface OtelExporterConfig {
  endpoint?: string;
  protocol?: "http/protobuf" | "grpc";
  headers?: Record<string, string>;
  traces?: { enabled?: boolean; endpoint?: string; batch?: { maxQueueSize?: number; flushIntervalMs?: number } };
  metrics?:
    | { mode: "otlp"; enabled?: boolean; endpoint?: string; exportIntervalMillis?: number; temporality?: "cumulative" | "delta" }
    | { mode: "prometheus"; enabled?: boolean; port?: number; endpoint?: string };
  logs?: { enabled?: boolean; endpoint?: string; batch?: { maxQueueSize?: number; flushIntervalMs?: number } };
}
```
