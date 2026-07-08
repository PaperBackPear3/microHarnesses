import type { ReadableSpan, TraceExporter } from "@micro-harnesses/core";
import type { OtelExporterConfig } from "../config";
import { resolveBatch, resolveHeaders, resolveSignalEndpoint } from "../config";
import { postJson } from "../transport";

export class OtlpTraceExporter implements TraceExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly batch: Required<ReturnType<typeof resolveBatch>>;
  private readonly queue: ReadableSpan[] = [];
  private timer?: NodeJS.Timeout;
  private inFlight = Promise.resolve();

  constructor(config: OtelExporterConfig = {}) {
    this.endpoint = resolveSignalEndpoint(config, "traces");
    this.headers = resolveHeaders(config);
    this.batch = resolveBatch(config.traces?.batch);
  }

  export(spans: ReadableSpan[]): void {
    this.queue.push(...spans);
    this.ensureTimer();
    if (this.queue.length >= this.batch.maxQueueSize) {
      void this.forceFlush();
    }
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
    }, this.batch.flushIntervalMs);
    this.timer.unref?.();
  }

  private async enqueueFlush(): Promise<void> {
    this.inFlight = this.inFlight
      .then(async () => {
        if (this.queue.length === 0) return;
        const items = this.queue.splice(0, this.queue.length);
        await postJson(
          this.endpoint,
          {
            resourceSpans: [
              {
                scopeSpans: [
                  {
                    spans: items.map((span) => ({
                      traceId: span.context.traceId,
                      spanId: span.context.spanId,
                      parentSpanId: span.context.parentSpanId,
                      name: span.name,
                      kind: "INTERNAL",
                      startTimeUnixNano: isoToUnixNano(span.startTime),
                      endTimeUnixNano: isoToUnixNano(span.endTime),
                      status: span.status,
                      attributes: { ...span.attributes, "mh.span.kind": span.kind },
                      events: span.events,
                      exceptions: span.exceptions,
                      resource: span.resource,
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
