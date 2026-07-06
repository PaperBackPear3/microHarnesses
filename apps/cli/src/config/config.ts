import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type CliMode, parseMode } from "../modes/modes";

export type EffortLevel = "low" | "medium" | "high";

export interface CliConfig {
  stateDir: string;
  promptsDir: string;
  provider: string;
  model?: string;
  effort: EffortLevel;
  mode: CliMode;
  maxIterations: number;
  snapshotEvery: number;
  maxTokens?: number;
  noSafety: boolean;
  privacyMode: boolean;
  sessionId?: string;
}

export interface ConfigOverrides {
  stateDir?: string;
  promptsDir?: string;
  provider?: string;
  model?: string;
  effort?: EffortLevel;
  mode?: CliMode;
  maxIterations?: number;
  snapshotEvery?: number;
  maxTokens?: number;
  noSafety?: boolean;
  privacyMode?: boolean;
  sessionId?: string;
}

interface FileConfig {
  stateDir?: string;
  promptsDir?: string;
  provider?: string;
  model?: string;
  effort?: string;
  mode?: string;
  maxIterations?: number;
  snapshotEvery?: number;
  maxTokens?: number;
  noSafety?: boolean;
  privacyMode?: boolean;
}

export async function loadCliConfig(overrides: ConfigOverrides): Promise<CliConfig> {
  const fromFile = await readConfigFile();
  const defaults: CliConfig = {
    stateDir: path.join(process.cwd(), ".micro-harness"),
    promptsDir: path.resolve(__dirname, "../../prompts"),
    provider: "openai",
    effort: "medium",
    mode: "accept-edits",
    maxIterations: 16,
    snapshotEvery: 4,
    noSafety: false,
    privacyMode: false,
  };

  const envStateDir = process.env.MH_STATE_DIR || process.env.MICRO_HARNESS_STATE_DIR;
  const envProvider = process.env.MH_PROVIDER || process.env.MICRO_HARNESS_PROVIDER;
  const envModel = process.env.MH_MODEL || process.env.MICRO_HARNESS_MODEL;
  const envEffort = parseEffort(process.env.MH_EFFORT || process.env.MICRO_HARNESS_EFFORT);
  const envMode = parseMode(process.env.MH_MODE || process.env.MICRO_HARNESS_MODE);
  const envMaxIterations = parseEnvPositiveInt(process.env.MH_MAX_ITERATIONS);
  const envSnapshotEvery = parseEnvPositiveInt(process.env.MH_SNAPSHOT_EVERY);

  return {
    stateDir: overrides.stateDir ?? envStateDir ?? fromFile.stateDir ?? defaults.stateDir,
    promptsDir: overrides.promptsDir ?? fromFile.promptsDir ?? defaults.promptsDir,
    provider: overrides.provider ?? envProvider ?? fromFile.provider ?? defaults.provider,
    model: overrides.model ?? envModel ?? fromFile.model ?? defaults.model,
    effort: overrides.effort ?? envEffort ?? parseEffort(fromFile.effort) ?? defaults.effort,
    mode: overrides.mode ?? envMode ?? parseMode(fromFile.mode) ?? defaults.mode,
    maxIterations:
      overrides.maxIterations ??
      fromFile.maxIterations ??
      envMaxIterations ??
      defaults.maxIterations,
    snapshotEvery:
      overrides.snapshotEvery ??
      fromFile.snapshotEvery ??
      envSnapshotEvery ??
      defaults.snapshotEvery,
    maxTokens: overrides.maxTokens ?? fromFile.maxTokens,
    noSafety: overrides.noSafety ?? fromFile.noSafety ?? defaults.noSafety,
    privacyMode: overrides.privacyMode ?? fromFile.privacyMode ?? defaults.privacyMode,
    sessionId: overrides.sessionId,
  };
}

function parseEnvPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}

export function parseEffort(value: string | undefined): EffortLevel | undefined {
  if (!value) return undefined;
  if (value === "low" || value === "medium" || value === "high") return value;
  if (value === "med") return "medium";
  return undefined;
}

async function readConfigFile(): Promise<FileConfig> {
  const configPath = path.join(os.homedir(), ".microharness", "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as FileConfig;
  } catch {
    return {};
  }
}
