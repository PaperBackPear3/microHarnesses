import type { ContentAnalysisConfig } from "../config.js";
import { fetchUrlAsset } from "../inputs/fetchUrl.js";
import { detectMimeType, isTextMimeType } from "../inputs/mime.js";
import {
  buildAssetViews,
  saveBufferAsInputAsset,
  type SessionStoreLike,
} from "../inputs/assets.js";

type ToolDefinition = import("@micro-harnesses/core").ToolDefinition;

export interface ContentAnalysisToolContext {
  config: ContentAnalysisConfig;
  sessionStore: SessionStoreLike;
}

export function createContentAnalysisTools(context: ContentAnalysisToolContext): ToolDefinition[] {
  return [
    {
      name: "fetch_url_asset",
      description: "Fetch a public HTTP/HTTPS URL, store it as a session asset, and return metadata.",
      risk: "low",
      tags: ["analysis", "ingest", "network"],
      capabilities: ["analysis.ingest"],
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          label: { type: "string" },
        },
        required: ["url"],
        additionalProperties: false,
      },
      inputAnnotations: [{ field: "url", kind: "url" }],
      async execute(input, executionContext) {
        const sessionId = executionContext?.sessionId;
        if (!sessionId) {
          throw new Error("fetch_url_asset requires an active session");
        }
        const url = typeof input.url === "string" ? input.url.trim() : "";
        if (!url) throw new Error('fetch_url_asset: "url" is required');
        const fetched = await fetchUrlAsset({
          url,
          timeoutMs: context.config.requestTimeoutMs,
          maxBytes: context.config.maxFetchBytes,
          maxRedirects: context.config.maxRedirects,
        });
        const asset = await saveBufferAsInputAsset({
          sessionStore: context.sessionStore,
          sessionId,
          stagingDir: pathJoin(context.config.stateDir, "staging"),
          filename: fetched.filename,
          bytes: fetched.bytes,
          mimeType: fetched.mimeType,
          sourceKind: "url",
          sourceValue: url,
        });
        return {
          assetId: asset.id,
          filename: asset.filename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          source: asset.source,
          finalUrl: fetched.finalUrl,
        };
      },
    },
    {
      name: "inspect_asset",
      description: "Inspect a stored request asset and return metadata plus a short preview when possible.",
      risk: "low",
      tags: ["analysis", "assets"],
      capabilities: ["analysis.assets"],
      inputSchema: {
        type: "object",
        properties: {
          assetId: { type: "string" },
        },
        required: ["assetId"],
        additionalProperties: false,
      },
      async execute(input, executionContext) {
        const sessionId = executionContext?.sessionId;
        if (!sessionId) {
          throw new Error("inspect_asset requires an active session");
        }
        const assetId = typeof input.assetId === "string" ? input.assetId.trim() : "";
        if (!assetId) throw new Error('inspect_asset: "assetId" is required');
        const asset = await context.sessionStore.getInputAsset(sessionId, assetId);
        if (!asset) {
          throw new Error(`Unknown asset: ${assetId}`);
        }
        const preview = await readPreview(asset.storagePath, asset.mimeType);
        return {
          assetId: asset.id,
          filename: asset.filename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          source: asset.source,
          preview,
        };
      },
    },
    {
      name: "extract_text_preview",
      description: "Extract a short text preview from a stored request asset when the file is text-like.",
      risk: "low",
      tags: ["analysis", "assets", "text"],
      capabilities: ["analysis.assets", "analysis.text"],
      inputSchema: {
        type: "object",
        properties: {
          assetId: { type: "string" },
          maxChars: { type: "number" },
        },
        required: ["assetId"],
        additionalProperties: false,
      },
      async execute(input, executionContext) {
        const sessionId = executionContext?.sessionId;
        if (!sessionId) {
          throw new Error("extract_text_preview requires an active session");
        }
        const assetId = typeof input.assetId === "string" ? input.assetId.trim() : "";
        if (!assetId) throw new Error('extract_text_preview: "assetId" is required');
        const maxChars = typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
          ? Math.max(1, Math.floor(input.maxChars))
          : 4000;
        const asset = await context.sessionStore.getInputAsset(sessionId, assetId);
        if (!asset) {
          throw new Error(`Unknown asset: ${assetId}`);
        }
        const preview = await readPreview(asset.storagePath, asset.mimeType, maxChars);
        return {
          assetId: asset.id,
          mimeType: asset.mimeType,
          preview,
          textLike: isTextMimeType(asset.mimeType),
        };
      },
    },
    {
      name: "list_request_assets",
      description: "List all assets attached to the current analysis session.",
      risk: "low",
      tags: ["analysis", "assets"],
      capabilities: ["analysis.assets"],
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async execute(_input, executionContext) {
        const sessionId = executionContext?.sessionId;
        if (!sessionId) {
          throw new Error("list_request_assets requires an active session");
        }
        const views = await buildAssetViews({
          sessionStore: context.sessionStore,
          sessionId,
          assetIds: (await context.sessionStore.listInputAssets(sessionId)).map((asset) => asset.id),
        });
        return {
          assets: views.map((view) => ({
            assetId: view.asset.id,
            filename: view.asset.filename,
            mimeType: view.asset.mimeType,
            source: view.sourceLabel,
            kind: view.kind,
            preview: view.preview,
          })),
        };
      },
    },
  ];
}

function pathJoin(...parts: string[]): string {
  return parts.join("/");
}

async function readPreview(storagePath: string, mimeType: string, maxChars = 4000): Promise<string | undefined> {
  if (mimeType === "application/pdf") {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const bytes = await import("node:fs/promises").then((fs) => fs.readFile(storagePath));
      const result = await pdfParse(bytes);
      const text = result.text.trim();
      return text.length > 0 ? text.slice(0, maxChars) : undefined;
    } catch {
      return undefined;
    }
  }
  if (!isTextMimeType(mimeType)) return undefined;
  const bytes = await import("node:fs/promises").then((fs) => fs.readFile(storagePath));
  const text = bytes.toString("utf8").trim();
  return text ? text.slice(0, maxChars) : undefined;
}
