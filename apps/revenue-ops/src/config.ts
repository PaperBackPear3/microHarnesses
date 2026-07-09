import path from "node:path";

export interface RevenueOpsConfig {
  stateDir: string;
  promptsDir: string;
  host: string;
  port: number;
  provider: string;
  model: string;
  maxTokens: number;
  maxRequestBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RevenueOpsConfig {
  const cwd = process.cwd();
  return {
    stateDir: env.REVENUE_OPS_STATE_DIR ?? path.join(cwd, ".micro-harness", "revenue-ops"),
    promptsDir: env.REVENUE_OPS_PROMPTS_DIR ?? path.join(cwd, "apps", "revenue-ops", "prompts"),
    host: env.REVENUE_OPS_HOST ?? "127.0.0.1",
    port: parseNumber(env.REVENUE_OPS_PORT, 3010),
    provider: env.REVENUE_OPS_PROVIDER ?? "ollama",
    model: env.REVENUE_OPS_MODEL ?? "gemma4:latest",
    maxTokens: parseNumber(env.REVENUE_OPS_MAX_TOKENS, 4096),
    maxRequestBytes: parseNumber(env.REVENUE_OPS_MAX_REQUEST_BYTES, 2 * 1024 * 1024),
  };
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
