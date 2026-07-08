import type { LogExporter, LogRecord } from "@micro-harnesses/core";
import type { OtelExporterConfig } from "../config";
import { resolveBatch, resolveHeaders, resolveSignalEndpoint } from "../config";
import { postJson } from "../transport";

export class OtlpLogExporter implements LogExporter {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private readonly batch: ReturnType<typeof resolveBatch>;
  private readonly queue: LogRecord[] = [];
  private timer?: NodeJS.Timeout;
  private inFlight = Promise.resolve();

  constructor(config: OtelExporterConfig = {}) {
    this.endpoint = resolveSignalEndpoint(config, "logs");
    this.headers = resolveHeaders(config);
    this.batch = resolveBatch(config.logs?.batch);
  }

  export(records: LogRecord[]): void {
    this.queue.push(...records);
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
            resourceLogs: [
              {
                scopeLogs: [
                  {
                    logRecords: items.map((record) => ({
                      timeUnixNano: isoToUnixNano(record.timestamp),
                      severityText: record.level.toUpperCase(),
                      severityNumber: severityNumber(record.level),
                      body: record.message,
                      attributes: record.attributes ?? {},
                      traceId: record.traceContext?.traceId,
                      spanId: record.traceContext?.spanId,
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

function severityNumber(level: LogRecord["level"]): number {
  if (level === "trace") return 1;
  if (level === "debug") return 5;
  if (level === "info") return 9;
  if (level === "warn") return 13;
  return 17;
}

function isoToUnixNano(iso: string): string {
  const millis = Date.parse(iso);
  return (BigInt(millis) * 1_000_000n).toString();
}
