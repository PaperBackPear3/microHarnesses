import path from "node:path";

export function detectMimeType(filename: string, bytes: Uint8Array, fallback = "application/octet-stream"): string {
  const ext = path.extname(filename).toLowerCase();
  const fromExt = mimeFromExtension(ext);
  if (fromExt) return fromExt;
  const fromMagic = mimeFromMagic(bytes);
  return fromMagic ?? fallback;
}

export function isTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/yaml" ||
    mimeType === "application/x-yaml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/typescript" ||
    mimeType === "application/csv" ||
    mimeType === "application/ld+json"
  );
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function mimeFromExtension(ext: string): string | undefined {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".html":
    case ".htm":
      return "text/html";
    case ".xml":
      return "application/xml";
    case ".yaml":
    case ".yml":
      return "application/yaml";
    case ".pdf":
      return "application/pdf";
    default:
      return undefined;
  }
}

function mimeFromMagic(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return "image/png";
    }
    if (
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9
    ) {
      return "image/jpeg";
    }
  }
  if (bytes.length >= 12) {
    const header = Buffer.from(bytes.slice(0, 12)).toString("ascii");
    if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "image/gif";
    if (header.slice(0, 4) === "RIFF" && header.slice(8, 12) === "WEBP") return "image/webp";
    if (header.startsWith("%PDF")) return "application/pdf";
  }
  const textSample = Buffer.from(bytes.slice(0, Math.min(bytes.length, 512))).toString("utf8");
  if (textSample.trim().startsWith("<html") || textSample.trim().startsWith("<!doctype html")) {
    return "text/html";
  }
  if (looksLikeJson(textSample)) return "application/json";
  if (looksLikeCsv(textSample)) return "text/csv";
  if (looksLikeUtf8(textSample)) return "text/plain";
  return undefined;
}

function looksLikeJson(sample: string): boolean {
  const trimmed = sample.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function looksLikeCsv(sample: string): boolean {
  const lines = sample.trim().split(/\r?\n/).filter(Boolean);
  return lines.length >= 2 && lines[0].includes(",") && lines[1].includes(",");
}

function looksLikeUtf8(sample: string): boolean {
  return sample.length > 0 && !sample.includes("\uFFFD");
}
