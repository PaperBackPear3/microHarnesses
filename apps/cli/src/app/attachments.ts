import { stat } from "node:fs/promises";
import path from "node:path";

export interface StagedAttachment {
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

export const DEFAULT_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export async function stageAttachment(
  filePath: string,
  maxBytes = DEFAULT_MAX_ATTACHMENT_BYTES,
): Promise<StagedAttachment> {
  const resolved = path.resolve(filePath);
  const file = await stat(resolved);
  if (!file.isFile()) {
    throw new Error(`Attachment path is not a file: ${filePath}`);
  }
  if (file.size > maxBytes) {
    throw new Error(
      `Attachment exceeds limit (${formatBytes(file.size)} > ${formatBytes(maxBytes)}): ${filePath}`,
    );
  }
  const filename = path.basename(resolved);
  const ext = path.extname(filename).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return {
    path: resolved,
    filename,
    mimeType,
    sizeBytes: file.size,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/**
 * Parses terminal drag-and-drop payloads into path candidates.
 * Supports:
 * - single bare path
 * - quoted paths ("..." or '...')
 * - escaped spaces (\ )
 * - multiple paths in one payload
 */
export function parseDroppedAttachmentPaths(input: string): string[] {
  const trimmed = input.trim();
  if (trimmed.length === 0) return [];
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index] ?? "";
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.trim().length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current.trim().length > 0) {
    result.push(current);
  }
  return result;
}
