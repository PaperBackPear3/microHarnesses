export interface BatchOptions {
  maxQueueSize?: number;
  flushIntervalMs?: number;
}

export interface OtelExporterConfig {
  endpoint?: string;
  protocol?: "http/protobuf" | "grpc";
  headers?: Record<string, string>;
  resource?: {
    serviceName?: string;
    serviceVersion?: string;
    attributes?: Record<string, string>;
  };
  traces?: { enabled?: boolean; endpoint?: string; batch?: BatchOptions };
  metrics?:
    | {
        mode: "otlp";
        enabled?: boolean;
        endpoint?: string;
        exportIntervalMillis?: number;
        temporality?: "cumulative" | "delta";
      }
    | { mode: "prometheus"; enabled?: boolean; port?: number; endpoint?: string };
  logs?: { enabled?: boolean; endpoint?: string; batch?: BatchOptions };
}

export function resolveSignalEndpoint(
  config: OtelExporterConfig,
  signal: "traces" | "metrics" | "logs",
): string {
  const envBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const envSignal = process.env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`];
  const fallbackBase = envBase ?? config.endpoint ?? "http://127.0.0.1:4318";
  const configured = resolveConfigSignalEndpoint(config, signal) ?? envSignal;
  if (configured) return configured;
  return `${fallbackBase.replace(/\/$/, "")}/v1/${signal}`;
}

export function resolveHeaders(config: OtelExporterConfig): Record<string, string> {
  const envHeaders = parseHeaderEnv(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  return { ...envHeaders, ...(config.headers ?? {}) };
}

export function resolveBatch(batch?: BatchOptions): Required<BatchOptions> {
  return {
    maxQueueSize: Math.max(1, Math.floor(batch?.maxQueueSize ?? 128)),
    flushIntervalMs: Math.max(100, Math.floor(batch?.flushIntervalMs ?? 1500)),
  };
}

function resolveConfigSignalEndpoint(
  config: OtelExporterConfig,
  signal: "traces" | "metrics" | "logs",
): string | undefined {
  if (signal === "traces") return config.traces?.endpoint;
  if (signal === "metrics" && config.metrics?.mode === "otlp") return config.metrics.endpoint;
  if (signal === "logs") return config.logs?.endpoint;
  return undefined;
}

function parseHeaderEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [key, ...rest] = entry.split("=");
    const trimmedKey = key?.trim();
    const value = rest.join("=").trim();
    if (trimmedKey && value) headers[trimmedKey] = value;
  }
  return headers;
}
