import type { IncomingMessage } from "node:http";
import type { InboundEvent } from "../domain/types.js";

export async function parseInboundEvent(req: IncomingMessage, maxBytes: number): Promise<InboundEvent> {
  const body = await readRequestBody(req, maxBytes);
  const parsed = JSON.parse(body.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const source = requireSource(record.source);
  return {
    source,
    type: requireString(record.type, "type"),
    occurredAt: requireString(record.occurredAt, "occurredAt"),
    accountId: optionalString(record.accountId),
    debtorId: optionalString(record.debtorId),
    payload: normalizePayload(record.payload),
  };
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new Error(`Request body exceeded ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireSource(value: unknown): InboundEvent["source"] {
  const source = requireString(value, "source");
  if (
    source === "crm" ||
    source === "billing" ||
    source === "support" ||
    source === "erp" ||
    source === "payment_gateway"
  ) {
    return source;
  }
  throw new Error("source must be one of crm|billing|support|erp|payment_gateway");
}

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
