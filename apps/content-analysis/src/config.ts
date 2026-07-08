import path from "node:path";

export interface ContentAnalysisConfig {
  stateDir: string;
  promptsDir: string;
  host: string;
  port: number;
  provider: string;
  model: string;
  maxTokens: number;
  requestTimeoutMs: number;
  maxRequestBytes: number;
  maxFetchBytes: number;
  maxRedirects: number;
  allowLocalPaths: boolean;
  localInputRoot: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ContentAnalysisConfig {
  const cwd = process.cwd();
  return {
    stateDir: env.CONTENT_ANALYSIS_STATE_DIR ?? path.join(cwd, ".micro-harness", "content-analysis"),
    promptsDir: env.CONTENT_ANALYSIS_PROMPTS_DIR ?? path.join(cwd, "apps", "content-analysis", "prompts"),
    host: env.CONTENT_ANALYSIS_HOST ?? "127.0.0.1",
    port: parseNumber(env.CONTENT_ANALYSIS_PORT, 3000),
    provider: env.CONTENT_ANALYSIS_PROVIDER ?? "ollama",
    model: env.CONTENT_ANALYSIS_MODEL ?? "gemma4:latest",
    maxTokens: parseNumber(env.CONTENT_ANALYSIS_MAX_TOKENS, 4096),
    requestTimeoutMs: parseNumber(env.CONTENT_ANALYSIS_REQUEST_TIMEOUT_MS, 15_000),
    maxRequestBytes: parseNumber(env.CONTENT_ANALYSIS_MAX_REQUEST_BYTES, 15 * 1024 * 1024),
    maxFetchBytes: parseNumber(env.CONTENT_ANALYSIS_MAX_FETCH_BYTES, 8 * 1024 * 1024),
    maxRedirects: parseNumber(env.CONTENT_ANALYSIS_MAX_REDIRECTS, 3),
    allowLocalPaths: parseBoolean(env.CONTENT_ANALYSIS_ALLOW_LOCAL_PATHS, false),
    localInputRoot: env.CONTENT_ANALYSIS_INPUT_ROOT ?? cwd,
  };
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}
