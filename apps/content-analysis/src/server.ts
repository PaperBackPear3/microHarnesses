import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AnalysisResponse, AnalysisResult } from "./analysis/schema.js";
import { normalizeAnalysisResult } from "./analysis/schema.js";
import type { ContentAnalysisConfig } from "./config.js";
import { createAnalysisAgents } from "./runtime/agent.js";
import { analyzeSession } from "./runtime/subagents.js";
import { buildAssetViews, buildUserContentParts, saveBufferAsInputAsset } from "./inputs/assets.js";
import { detectMimeType, isImageMimeType } from "./inputs/mime.js";
import { fetchUrlAsset } from "./inputs/fetchUrl.js";
import { parseJsonAnalysisRequest } from "./http/jsonEndpoint.js";
import { parseMultipartAnalysisRequest } from "./http/multipartEndpoint.js";

export interface AnalysisServer {
  server: ReturnType<typeof createServer>;
  agents: ReturnType<typeof createAnalysisAgents>;
}

export function createAnalysisServer(config: ContentAnalysisConfig): AnalysisServer {
  const agents = createAnalysisAgents(config);
  const server = createServer(async (req, res) => {
    try {
      await handleRequest(config, agents, req, res);
    } catch (error) {
      sendError(res, error);
    }
  });
  return { server, agents };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function serveStaticFile(res: ServerResponse, filePath: string): Promise<boolean> {
  const ext = path.extname(filePath);
  const contentType = STATIC_MIME[ext];
  if (!contentType) return false;
  // Guard against path traversal
  const resolved = path.resolve(filePath);
  if (path.relative(PUBLIC_DIR, resolved).startsWith("..")) return false;
  try {
    const content = await readFile(resolved);
    res.writeHead(200, { "content-type": contentType, "content-length": content.length });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(
  config: ContentAnalysisConfig,
  agents: ReturnType<typeof createAnalysisAgents>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      provider: config.provider,
      model: config.model,
      maxTokens: config.maxTokens,
    });
    return;
  }

  if (method === "POST" && url.pathname === "/analyze") {
    const contentType = req.headers["content-type"] ?? "";
    const requestId = randomUUID();
    const sessionId = `s-${requestId}`;
    await mkdir(path.join(config.stateDir, "staging"), { recursive: true });
    await agents.sessionStore.initSession({ sessionId, goal: "Analyze supplied content" });

    const normalized =
      contentType.includes("multipart/form-data")
        ? await parseMultipartAnalysisRequest(req, config.maxRequestBytes)
        : contentType.includes("application/json") || contentType === ""
          ? await parseJsonAnalysisRequest(req, config.maxRequestBytes)
          : (() => {
              throw new Error(`Unsupported content type: ${contentType}`);
            })();

    const assetIds: string[] = [];
    const textParts: string[] = [];

    if (normalized.text) textParts.push(normalized.text);
    if (normalized.instructions) textParts.push(`Instructions: ${normalized.instructions}`);

    for (const urlItem of normalized.urls) {
      const fetched = await fetchUrlAsset({
        url: urlItem,
        timeoutMs: config.requestTimeoutMs,
        maxBytes: config.maxFetchBytes,
        maxRedirects: config.maxRedirects,
      });
      const asset = await saveBufferAsInputAsset({
        sessionStore: agents.sessionStore,
        sessionId,
        stagingDir: path.join(config.stateDir, "staging"),
        filename: fetched.filename,
        bytes: fetched.bytes,
        mimeType: fetched.mimeType,
        sourceKind: "url",
        sourceValue: urlItem,
      });
      assetIds.push(asset.id);
      textParts.push(`Fetched URL: ${urlItem} -> ${asset.filename} (${asset.mimeType})`);
    }

    for (const localPath of normalized.paths) {
      if (!config.allowLocalPaths) {
        throw new Error("Local file paths are disabled in this server configuration");
      }
      const inputRoot = path.resolve(config.localInputRoot);
      const absolute = path.resolve(inputRoot, localPath);
      const relative = path.relative(inputRoot, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path escapes input root: ${localPath}`);
      }
      const bytes = await import("node:fs/promises").then((fs) => fs.readFile(absolute));
      const mimeType = detectMimeType(path.basename(absolute), bytes);
      const asset = await saveBufferAsInputAsset({
        sessionStore: agents.sessionStore,
        sessionId,
        stagingDir: path.join(config.stateDir, "staging"),
        filename: path.basename(absolute),
        bytes,
        mimeType,
        sourceKind: "path",
        sourceValue: absolute,
      });
      assetIds.push(asset.id);
      textParts.push(`Local file: ${localPath} -> ${asset.filename} (${asset.mimeType})`);
    }

    for (const file of normalized.files ?? []) {
      const mimeType = file.mimeType || detectMimeType(file.filename, file.bytes);
      const asset = await saveBufferAsInputAsset({
        sessionStore: agents.sessionStore,
        sessionId,
        stagingDir: path.join(config.stateDir, "staging"),
        filename: file.filename,
        bytes: file.bytes,
        mimeType,
        sourceKind: "path",
        sourceValue: file.filename,
      });
      assetIds.push(asset.id);
      textParts.push(`Uploaded file: ${file.filename} (${asset.mimeType})`);
    }

    const views = await buildAssetViews({
      sessionStore: agents.sessionStore,
      sessionId,
      assetIds,
    });

    const result = await analyzeSession(agents, {
      sessionId,
      runId: requestId,
      views,
      text: textParts.join("\n"),
      instructions: normalized.instructions,
    });

    sendJson(res, 200, {
      sessionId,
      runId: requestId,
      provider: config.provider,
      model: config.model,
      ...result,
      rawAssistantMessage: result.rawAssistantMessage,
    } satisfies AnalysisResponse);
    return;
  }

  // Static files
  if (method === "GET") {
    const filePath =
      url.pathname === "/" || url.pathname === ""
        ? path.join(PUBLIC_DIR, "index.html")
        : path.join(PUBLIC_DIR, url.pathname);
    if (await serveStaticFile(res, filePath)) return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = /exceeded|disabled|blocked|invalid|unsupported/i.test(message) ? 400 : 500;
  sendJson(res, statusCode, { error: message });
}
