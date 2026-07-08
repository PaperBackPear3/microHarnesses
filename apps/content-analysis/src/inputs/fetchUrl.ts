import { lookup } from "node:dns/promises";
import { URL } from "node:url";

export interface FetchedUrlAsset {
  url: string;
  finalUrl: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function fetchUrlAsset(options: {
  url: string;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}): Promise<FetchedUrlAsset> {
  const initial = new URL(options.url);
  assertSafeHttpUrl(initial);
  await assertHostIsPublic(initial.hostname);

  let current = initial;
  for (let redirect = 0; redirect <= options.maxRedirects; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect response missing Location header");
      }
      current = new URL(location, current);
      assertSafeHttpUrl(current);
      await assertHostIsPublic(current.hostname);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch ${current.toString()}: ${response.status} ${response.statusText}`);
    }

    const bytes = await readLimitedBody(response, options.maxBytes);
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
    return {
      url: options.url,
      finalUrl: current.toString(),
      filename: filenameFromUrl(current),
      mimeType,
      bytes,
    };
  }

  throw new Error(`Too many redirects while fetching ${options.url}`);
}

export function assertSafeHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }
}

async function assertHostIsPublic(hostname: string): Promise<void> {
  if (isBlockedLiteral(hostname)) {
    throw new Error(`Blocked local or private host: ${hostname}`);
  }
  if (looksLikeIp(hostname)) {
    return;
  }
  const records = await lookup(hostname, { all: true });
  for (const record of records) {
    if (isBlockedLiteral(record.address)) {
      throw new Error(`Blocked local or private host: ${hostname}`);
    }
  }
}

function isBlockedLiteral(host: string): boolean {
  return isPrivateIp(host) || host === "localhost" || host === "::1";
}

function looksLikeIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function isPrivateIp(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const octets = host.split(".").map(Number);
    if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
      return true;
    }
    const [a, b] = octets;
    return (
      a === 10 ||
      (a === 127) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    );
  }
  const lower = host.toLowerCase();
  return lower === "localhost" || lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Response body exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function filenameFromUrl(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop();
  return last && last.length > 0 ? last : "download";
}
