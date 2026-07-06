export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_OLLAMA_CONTEXT_WINDOW_TOKENS = 8_192;

interface DetectOllamaContextWindowOptions {
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function normalizeOllamaBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return trimmed.slice(0, -3);
  }
  return trimmed;
}

export function parseOllamaContextWindow(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const directKeys = [
    record.context_length,
    record.contextLength,
    record.num_ctx,
    record.numCtx,
    getNested(record, ["details", "context_length"]),
    getNested(record, ["details", "contextLength"]),
    getNested(record, ["details", "num_ctx"]),
    getNested(record, ["details", "numCtx"]),
    getNested(record, ["options", "num_ctx"]),
    getNested(record, ["options", "numCtx"]),
  ];
  for (const candidate of directKeys) {
    const parsed = parsePositiveInt(candidate);
    if (parsed) return parsed;
  }

  const modelInfo = record.model_info;
  if (modelInfo && typeof modelInfo === "object") {
    const modelRecord = modelInfo as Record<string, unknown>;
    for (const [key, value] of Object.entries(modelRecord)) {
      if (!key.toLowerCase().includes("context_length")) continue;
      const parsed = parsePositiveInt(value);
      if (parsed) return parsed;
    }
  }

  const parameters = record.parameters;
  if (typeof parameters === "string") {
    const match = parameters.match(/\bnum_ctx\s+(\d+)\b/i);
    if (match?.[1]) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }

  return undefined;
}

export async function detectOllamaContextWindowTokens(
  options: DetectOllamaContextWindowOptions,
): Promise<number | undefined> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = Math.max(250, Math.floor(options.timeoutMs ?? 2_500));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${normalizeOllamaBaseUrl(options.baseUrl)}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: options.model }),
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as unknown;
    return parseOllamaContextWindow(payload);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function getNested(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}
