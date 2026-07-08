import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { detectMimeType, isImageMimeType, isTextMimeType } from "./mime.js";

export interface InputAsset {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  source?: { kind: "path" | "url"; value: string };
  sha256?: string;
  createdAt: string;
}

export type MessageContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      assetId: string;
      mimeType: string;
      detail?: "low" | "high" | "auto";
      altText?: string;
    }
  | {
      type: "file";
      assetId: string;
      mimeType: string;
      filename: string;
      title?: string;
    };

export interface SessionStoreLike {
  initSession(options?: { sessionId?: string; goal?: string }): Promise<unknown>;
  saveInputAsset(
    sessionId: string,
    sourcePath: string,
    options?: { mimeType?: string; sourceKind?: "path" | "url" },
  ): Promise<InputAsset>;
  getInputAsset(sessionId: string, assetId: string): Promise<InputAsset | undefined>;
  listInputAssets(sessionId: string): Promise<InputAsset[]>;
}

export interface AnalysisAssetView {
  asset: InputAsset;
  sourceLabel: string;
  preview?: string;
  kind: "image" | "document" | "text";
}

export async function saveBufferAsInputAsset(options: {
  sessionStore: SessionStoreLike;
  sessionId: string;
  stagingDir: string;
  filename: string;
  bytes: Uint8Array;
  mimeType?: string;
  sourceKind?: "path" | "url";
  sourceValue: string;
}): Promise<InputAsset> {
  await mkdir(options.stagingDir, { recursive: true });
  const tempPath = path.join(options.stagingDir, `incoming-${randomUUID()}-${options.filename}`);
  await writeFile(tempPath, options.bytes);
  try {
    return await options.sessionStore.saveInputAsset(options.sessionId, tempPath, {
      mimeType: options.mimeType,
      sourceKind: options.sourceKind,
    });
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      // ignore temp cleanup failures
    }
  }
}

export async function buildAssetViews(options: {
  sessionStore: SessionStoreLike;
  sessionId: string;
  assetIds: string[];
}): Promise<AnalysisAssetView[]> {
  const views: AnalysisAssetView[] = [];
  for (const assetId of options.assetIds) {
    const asset = await options.sessionStore.getInputAsset(options.sessionId, assetId);
    if (!asset) continue;
    const preview = await buildPreview(asset);
    const kind = isImageMimeType(asset.mimeType)
      ? "image"
      : isTextMimeType(asset.mimeType)
        ? "text"
        : "document";
    views.push({
      asset,
      sourceLabel: asset.source?.value ?? asset.filename,
      preview,
      kind,
    });
  }
  return views;
}

export async function buildUserContentParts(views: AnalysisAssetView[]): Promise<MessageContentPart[]> {
  const parts: MessageContentPart[] = [];
  for (const view of views) {
    if (view.kind === "image") {
      parts.push({
        type: "image",
        assetId: view.asset.id,
        mimeType: view.asset.mimeType,
        altText: view.asset.filename,
      });
      continue;
    }
    const label = `${view.asset.filename} (${view.asset.mimeType})`;
    const preview = view.preview ?? "No textual preview was available.";
    parts.push({
      type: "text",
      text: `Attached content: ${label}\nSource: ${view.sourceLabel}\nPreview:\n${preview}`,
    });
  }
  return parts;
}

export async function buildAnalysisDraftPrompt(
  title: string,
  views: AnalysisAssetView[],
  instructions: string,
): Promise<string> {
  const sections = [
    `Analyze the attached ${title}.`,
    "Return STRICT JSON with the exact shape:",
    `{
  "summary": "short summary",
  "categories": [{"name":"...","confidence":"low|medium|high","reason":"..."}],
  "clarifications": [{"issue":"...","bestEffortInterpretation":"...","whatWouldHelp":"..."}],
  "items": [{"source":"...","mimeType":"...","summary":"...","categories":["..."]}]
}`,
    "Open-ended categories are preferred.",
    "If content is confusing or partially obscured, add clarifications instead of guessing.",
  ];
  if (instructions.trim().length > 0) {
    sections.push(`User instructions:\n${instructions.trim()}`);
  }
  if (views.length > 0) {
    sections.push(
      "Content inventory:",
      ...views.map((view) => {
        const preview = view.preview ? `\nPreview:\n${view.preview}` : "";
        return `- ${view.asset.filename} (${view.asset.mimeType}) from ${view.sourceLabel}${preview}`;
      }),
    );
  }
  return sections.join("\n\n");
}

async function buildPreview(asset: InputAsset): Promise<string | undefined> {
  if (asset.mimeType === "application/pdf") {
    return extractPdfText(asset.storagePath, 4000);
  }
  if (!isTextMimeType(asset.mimeType)) {
    return undefined;
  }
  const bytes = await readFile(asset.storagePath);
  const text = bytes.toString("utf8").trim();
  if (!text) return undefined;
  if (asset.mimeType === "text/html") {
    return stripHtml(text).slice(0, 4000);
  }
  return text.slice(0, 4000);
}

async function extractPdfText(filePath: string, maxChars: number): Promise<string | undefined> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const bytes = await readFile(filePath);
    const result = await pdfParse(bytes);
    const text = result.text.trim();
    return text.length > 0 ? text.slice(0, maxChars) : undefined;
  } catch {
    return undefined;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
