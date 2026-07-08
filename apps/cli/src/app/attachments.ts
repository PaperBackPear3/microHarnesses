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
