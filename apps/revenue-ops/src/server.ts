import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseInboundEvent } from "./http/jsonEndpoint.js";
import { log } from "./logger.js";
import { RevenueOpsService } from "./orchestration/service.js";
import { createRevenueOpsAgents } from "./runtime/agent.js";
import { JsonCaseStore } from "./store/caseStore.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

export interface RevenueOpsServer {
  server: ReturnType<typeof createServer>;
}

export function createRevenueOpsServer(config: any): RevenueOpsServer {
  const store = new JsonCaseStore(config.stateDir);
  const agents = createRevenueOpsAgents(config);
  const service = new RevenueOpsService(store, config, agents);

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, config, service);
    } catch (error) {
      sendError(res, error);
    }
  });
  return { server };
}

async function serveStaticFile(res: ServerResponse, pathname: string): Promise<boolean> {
  const ext = path.extname(pathname);
  const contentType = STATIC_MIME[ext];
  if (!contentType) return false;
  const resolved = path.resolve(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname.substring(1));
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
  req: IncomingMessage,
  res: ServerResponse,
  config: any,
  service: RevenueOpsService,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Serve static files first
  if (await serveStaticFile(res, url.pathname)) return;

  if (method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      provider: config.provider,
      model: config.model,
      channels: ["email", "crm_task"],
      externalIntegrationsMode: "stub",
    });
    return;
  }

  if (method === "POST" && url.pathname === "/events") {
    const event = await parseInboundEvent(req, config.maxRequestBytes);
    const updated = await service.ingest(event);
    sendJson(res, 202, { accepted: true, case: updated });
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/run/retention/")) {
    const accountId = decodeEntity(url.pathname, "/run/retention/");
    const result = await service.runRetention(accountId);
    sendJson(res, 200, result);
    return;
  }

  if (method === "POST" && url.pathname.startsWith("/run/collections/")) {
    const debtorId = decodeEntity(url.pathname, "/run/collections/");
    const result = await service.runCollections(debtorId);
    sendJson(res, 200, result);
    return;
  }

  if (method === "GET" && url.pathname.startsWith("/cases/")) {
    const id = decodeEntity(url.pathname, "/cases/");
    const found = await service.getCase(id);
    if (!found) {
      sendJson(res, 404, { error: "Case not found" });
      return;
    }
    sendJson(res, 200, found);
    return;
  }

  if (method === "GET" && url.pathname === "/kpis") {
    const summary = await service.kpis();
    sendJson(res, 200, summary);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function decodeEntity(pathname: string, prefix: string): string {
  const raw = pathname.slice(prefix.length);
  const value = decodeURIComponent(raw).trim();
  if (value.length === 0) {
    throw new Error(`Missing entity in path: ${pathname}`);
  }
  return value;
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
  const statusCode = /missing|must|invalid|not found|exceeded/i.test(message) ? 400 : 500;
  log("error", "server", message);
  sendJson(res, statusCode, { error: message });
}
