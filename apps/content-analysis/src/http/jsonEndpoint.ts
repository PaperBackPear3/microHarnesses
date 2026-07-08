import type { IncomingMessage } from "node:http";

export interface NormalizedAnalysisRequest {
  text?: string;
  instructions?: string;
  urls: string[];
  paths: string[];
  files?: Array<{ name: string; bytes: Uint8Array; mimeType: string; filename: string }>;
}

export async function parseJsonAnalysisRequest(req: IncomingMessage, maxBytes: number): Promise<NormalizedAnalysisRequest> {
  const body = await readRequestBody(req, maxBytes);
  const parsed = JSON.parse(body.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  return {
    text: optionalString(record.text),
    instructions: optionalString(record.instructions),
    urls: optionalStringArray(record.urls),
    paths: optionalStringArray(record.paths),
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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}
