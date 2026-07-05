# Plan: `@micro-harnesses/plugin-observability-otel`

Concrete OpenTelemetry / OTLP exporter plugin that bridges core's zero-dependency
observability signals to real backends: **Jaeger** / **Tempo** (traces),
**Prometheus** (metrics), **Grafana** (dashboards), and **Loki** (logs) — via the
OpenTelemetry Collector or direct OTLP endpoints.

> Status: **proposed** (follow-up to the core observability v2 work).
> Core stays zero-dependency; all OpenTelemetry SDK dependencies live in this
> plugin package only.

---

## 1. Goal & scope

Ship a publishable workspace plugin, `plugins/observability-otel`, that:

- Adapts core's `TraceExporter` / `MetricExporter` / `LogExporter` (which receive
  `ReadableSpan[]` / `MetricRecord[]` / `LogRecord[]`) to the OpenTelemetry SDK
  and exports over **OTLP** (http/protobuf and grpc).
- Registers itself through the core `"observability"` plugin capability
  (`PluginApi.observability.register{Trace,Metric,Log}Exporter`).
- Provides an optional **Prometheus pull** exporter for metrics (scrape `/metrics`)
  as an alternative to OTLP push.
- Batches, flushes, and shuts down cleanly (wired to
  `ObservabilityProvider.forceFlush()` / `shutdown()`).

**Out of scope:** changing anything in `packages/core`; the contracts added in v2
are sufficient. Dashboard JSON and alert rules are provided as optional examples
only.

---

## 2. Package layout (mirror existing plugins)

```
plugins/observability-otel/
  package.json            # name @micro-harnesses/plugin-observability-otel, peer core ^1.0.0
  tsconfig.json           # extends ../../tsconfig.base.json
  README.md
  src/
    index.ts              # barrel: plugin + exporters + config
    observabilityOtelPlugin.ts   # HarnessPlugin, capabilities: ["observability"]
    config.ts             # OtelExporterConfig (endpoints, protocol, headers, resource, intervals)
    resource.ts           # merge core resource attrs -> OTel Resource
    ids.ts                # hex trace/span id <-> OTLP bytes helpers
    attributes.ts         # core AttributeValue -> OTel AnyValue mapping
    trace/
      spanConverter.ts    # core ReadableSpan -> OTel ReadableSpan (sdk-trace-base)
      otlpTraceExporter.ts# TraceExporter impl wrapping OTLPTraceExporter + BatchSpanProcessor
    metrics/
      aggregator.ts       # aggregate core MetricRecord stream -> sum/gauge/histogram
      otlpMetricExporter.ts   # MetricExporter impl (OTLP push, PeriodicExportingMetricReader)
      prometheusExporter.ts   # optional pull-based /metrics server
    logs/
      logConverter.ts     # core LogRecord -> OTel LogRecord (level -> severityNumber)
      otlpLogExporter.ts  # LogExporter impl wrapping OTLPLogExporter + BatchLogRecordProcessor
    *.test.ts             # unit tests per converter/exporter
```

Add `plugins/observability-otel` under the root `workspaces` glob (already
`plugins/*`, so no change needed) and to `docs/package-reference.md`.

---

## 3. Dependencies (this package only)

Runtime (pin to one compatible OTel SDK line, e.g. `^1.x` stable + `^0.5x` for
experimental logs/metrics):

- `@opentelemetry/api`
- `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`
- `@opentelemetry/sdk-trace-base` (`BatchSpanProcessor`, `ReadableSpan`)
- `@opentelemetry/exporter-trace-otlp-http` (+ optional `-grpc`, `-proto`)
- `@opentelemetry/sdk-metrics` (aggregation types, temporality)
- `@opentelemetry/exporter-metrics-otlp-http` (+ optional `-grpc`)
- `@opentelemetry/exporter-prometheus` (optional pull path)
- `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http`

`peerDependencies`: `@micro-harnesses/core: ^1.0.0`.

Module format: core plugins compile to CommonJS (`require` in `exports`). Verify
the chosen OTel packages resolve under CJS via `tsconfig.base.json`; pin versions
and add a smoke `require()` test to guard ESM/CJS regressions.

---

## 4. Signal mapping

### 4.1 Traces (core `ReadableSpan` → OTLP)
- **Ids**: core ids are lowercase hex (`traceId` 32, `spanId` 16). Convert to the
  byte form the OTLP exporter expects (`ids.ts`). Preserve `parentSpanId`.
- **Span kind**: core `SpanKind` (`run|iteration|model|tool|skill|context|policy|
  approval|subagent`) has no OTel equivalent → map all to OTel `INTERNAL` and add
  attribute `mh.span.kind = <kind>` for filtering in Jaeger/Tempo.
- **Timing**: ISO `startTime`/`endTime` → OTel `HrTime` (`[seconds, nanos]`).
- **Attributes**: `attributes.ts` maps core `AttributeValue` (primitives + arrays)
  to OTel attribute values.
- **Events**: core `SpanEventRecord` → OTel span events (name, time, attributes).
  Note: streamed model deltas already arrive as span events on the model span.
- **Status**: core `SpanStatus` (`unset|ok|error`) → OTel `SpanStatusCode`.
- **Exceptions**: core `SpanException[]` → OTel exception events
  (`exception.type/message/stacktrace`) + `error.category` attribute.
- **Resource**: `resource.ts` merges core resource attrs (`service.name`,
  `service.version`, …) into an OTel `Resource`.
- **Delivery**: feed converted spans into a `BatchSpanProcessor` → `OTLPTraceExporter`.
  The core `TraceExporter.export(spans)` pushes into the processor; `forceFlush`/
  `shutdown` delegate to the processor.

### 4.2 Metrics (core `MetricRecord` stream → OTLP/Prometheus)
Core's `DefaultMeter` emits **one `MetricRecord` per measurement** (no
aggregation). OTLP/Prometheus need aggregated series. Two implementation options:

- **Option A (recommended): SDK-backed instruments.** On first sight of a metric
  `name` (+`kind`), lazily create the matching OTel instrument
  (`Counter`/`UpDownCounter`/`Histogram`) on a `MeterProvider` configured with a
  `PeriodicExportingMetricReader` (OTLP) or `PrometheusExporter`. Replay each core
  `MetricRecord` as `add()`/`record()` with its attributes. The SDK handles
  aggregation, temporality, and export cadence. Keep an instrument cache keyed by
  name.
- **Option B: hand-rolled aggregator** (`aggregator.ts`) that maintains
  cumulative sums / histogram buckets keyed by `name + serialized attributes` and
  emits OTLP `ResourceMetrics` on a timer/flush. More code, full control; use only
  if Option A's instrument model proves too rigid.

Config: temporality (cumulative vs delta), export interval, and histogram bucket
boundaries per instrument (e.g. duration histograms in ms).

Metric names already follow the OTel-compatible dotted convention (see core
`MetricNames`), so no renaming is required.

### 4.3 Logs (core `LogRecord` → OTLP)
- **Severity**: map core `LogLevel` (`trace|debug|info|warn|error`) → OTel
  `SeverityNumber` (TRACE=1, DEBUG=5, INFO=9, WARN=13, ERROR=17).
- **Correlation**: attach `traceId`/`spanId` from `LogRecord.traceContext` so logs
  join their spans in Grafana.
- **Body/attributes**: `message` → log body; `attributes` → OTel log attributes.
- **Delivery**: `BatchLogRecordProcessor` → `OTLPLogExporter`.

---

## 5. Configuration (`config.ts`)

```ts
export interface OtelExporterConfig {
  // Common
  endpoint?: string;                 // base OTLP endpoint (per-signal overrides below)
  protocol?: "http/protobuf" | "grpc";
  headers?: Record<string, string>;  // e.g. auth for Grafana Cloud / Tempo
  resource?: { serviceName?: string; serviceVersion?: string; attributes?: Record<string, string> };

  traces?: { enabled?: boolean; endpoint?: string; batch?: BatchOptions };
  metrics?:
    | { mode: "otlp"; enabled?: boolean; endpoint?: string; exportIntervalMillis?: number;
        temporality?: "cumulative" | "delta" }
    | { mode: "prometheus"; enabled?: boolean; port?: number; endpoint?: string /* /metrics */ };
  logs?: { enabled?: boolean; endpoint?: string; batch?: BatchOptions };
}
```

Honor standard `OTEL_EXPORTER_OTLP_*` environment variables as fallbacks so the
plugin works with zero config against a local Collector.

---

## 6. Plugin surface

```ts
export class ObservabilityOtelPlugin implements HarnessPlugin {
  readonly name = "observability-otel-plugin";
  readonly capabilities: PluginCapability[] = ["observability"];
  constructor(private readonly config: OtelExporterConfig = {}) {}

  register(api: PluginApi): void {
    if (this.config.traces?.enabled !== false) {
      api.observability.registerTraceExporter(new OtlpTraceExporter(this.config));
    }
    if (this.config.metrics?.enabled !== false) {
      api.observability.registerMetricExporter(createMetricExporter(this.config)); // otlp | prometheus
    }
    if (this.config.logs?.enabled !== false) {
      api.observability.registerLogExporter(new OtlpLogExporter(this.config));
    }
  }
}
```

Compositions wire it after `createObservability(...)` / `DefaultObservabilityProvider`
so exporters attach via `addTraceExporter` / `addMetricExporter` / `addLogExporter`
(as the CLI's `PluginObservabilityHost` already does).

---

## 7. Backends & how they consume the output

| Backend | Signal | Path |
|---|---|---|
| **Jaeger** | traces | OTLP → Jaeger native OTLP ingest (or via Collector) |
| **Tempo** | traces | OTLP → Tempo distributor |
| **Prometheus** | metrics | pull `/metrics` (Prometheus mode) **or** OTLP → Collector → `prometheusremotewrite` |
| **Grafana** | all | dashboards over Tempo (traces) + Prometheus (metrics) + Loki (logs) |
| **Loki** | logs | OTLP → Collector `otlp` receiver → `loki` exporter |

Ship an optional `examples/docker-compose.yaml` (otel-collector + jaeger +
prometheus + grafana + loki) and a starter Grafana dashboard JSON built on the
core metric catalog (token usage, tool/skill durations, context-window
utilization, error counters) for local verification.

---

## 8. Testing

- **Unit (in-package, `node --test`)**:
  - `ids.ts`: hex↔bytes round-trip; rejects malformed ids.
  - `attributes.ts`: primitive + array mapping.
  - `spanConverter.ts`: kind→INTERNAL + `mh.span.kind`, status/exception mapping,
    HrTime conversion, event mapping.
  - `aggregator`/instrument path: a stream of core `MetricRecord`s produces correct
    counter sums, histogram counts/buckets, gauge last-value.
  - `logConverter.ts`: level→severityNumber, trace correlation.
- **Exporter contract**: fake OTLP sink (in-memory HTTP server) asserting a
  round-trip span/metric/log payload; assert `forceFlush`/`shutdown` drain batches.
- **CJS smoke test**: `require("@micro-harnesses/plugin-observability-otel")`.
- **Optional integration**: docker-compose stack, manual/CI-gated (not in the
  default `node --test` run).

Follow repo conventions: build first (`npm run build`), tests run compiled JS
(`node --test "dist/**/*.test.js"`), Biome lint clean.

---

## 9. Docs

- New `plugins/observability-otel/README.md` (quickstart + config + backend recipes).
- Update `docs/how-to-compose-plugins.md` with an "export telemetry to OTLP" section.
- Add the package to `docs/package-reference.md`.
- Cross-link from `packages/core/README.md` (Observability section) to this plugin.

---

## 10. Risks & decisions

- **OTel SDK version churn** (metrics/logs still `0.x`): pin exact versions;
  isolate all OTel imports behind the converter modules so upgrades are localized.
- **Metric aggregation model**: prefer Option A (SDK instruments) to avoid
  reimplementing histogram bucketing; fall back to Option B only if needed.
- **CJS/ESM interop**: verified by the smoke test; may require `esModuleInterop`
  already set in `tsconfig.base.json`.
- **Span-kind fidelity**: OTel lacks our domain kinds → carried as an attribute;
  document the `mh.span.kind` convention for dashboard authors.
- **PII**: redaction happens in core before export (privacy mode / denyKeys), so
  this plugin never needs to scrub content — but document that operators should
  still secure the Collector/backends.

---

## 11. Milestones

1. **Scaffold** package (package.json, tsconfig, README, barrel) + declare plugin
   with `["observability"]` capability and no-op exporters.
2. **Traces**: ids/attributes/resource + spanConverter + OTLP trace exporter + tests.
3. **Logs**: logConverter + OTLP log exporter + tests.
4. **Metrics**: SDK-instrument exporter (OTLP) + tests; then Prometheus pull mode.
5. **Flush/shutdown** wiring verified against `ObservabilityProvider` lifecycle.
6. **Examples**: docker-compose + Grafana dashboard; backend recipes in README.
7. **Docs + package-reference**; bump to `1.0.0`; validate full workspace
   build/test/lint.
