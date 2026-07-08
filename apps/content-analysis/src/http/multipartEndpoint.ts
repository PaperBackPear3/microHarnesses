import type { IncomingMessage } from "node:http";
import { NormalizedAnalysisRequest } from "./jsonEndpoint.js";

export interface MultipartAnalysisRequest extends NormalizedAnalysisRequest {
  files: Array<{ name: string; bytes: Uint8Array; mimeType: string; filename: string }>;
}

export async function parseMultipartAnalysisRequest(
  req: IncomingMessage,
  maxBytes: number,
): Promise<MultipartAnalysisRequest> {
  const body = await readRequestBody(req, maxBytes);
  const request = new Request("http://localhost/analyze", {
    method: req.method ?? "POST",
    headers: req.headers as HeadersInit,
    body: new Blob([new Uint8Array(body)]),
  });
  const form = await request.formData();
  const files: MultipartAnalysisRequest["files"] = [];
  const fileEntries: Array<{ key: string; value: File }> = [];
  const urls: string[] = [];
  const paths: string[] = [];
  let text: string | undefined;
  let instructions: string | undefined;

  form.forEach((value, key) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return;
      if (key === "text") text = trimString(text, trimmed);
      else if (key === "instructions") instructions = trimString(instructions, trimmed);
      else if (key === "url") urls.push(trimmed);
      else if (key === "urls") urls.push(...splitList(trimmed));
      else if (key === "path") paths.push(trimmed);
      else if (key === "paths") paths.push(...splitList(trimmed));
      return;
    }
    if (isFileLike(value)) {
      fileEntries.push({ key, value });
    }
  });

  for (const { key, value } of fileEntries) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    files.push({
      name: key,
      filename: value.name || "upload",
      mimeType: value.type || "application/octet-stream",
      bytes,
    });
  }

  return { text, instructions, urls, paths, files };
}

function isFileLike(value: FormDataEntryValue): value is File {
  return typeof value !== "string" && typeof value.arrayBuffer === "function";
}

function trimString(existing: string | undefined, next: string): string {
  return existing ? `${existing}\n${next}` : next;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
