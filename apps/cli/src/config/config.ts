import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type EffortLevel, type HarnessMode, parseEffort, parseMode } from "@micro-harnesses/core";

export type { EffortLevel };
export { parseEffort };

export interface CliConfig {
  stateDir: string;
  promptsDir: string;
  /** Directory of FS skills (SKILL.md bundles). Defaults to `<stateDir>/skills`. */
  skillsDir?: string;
  provider: string;
  model?: string;
  effort: EffortLevel;
  mode: HarnessMode;
  maxIterations: number;
  snapshotEvery: number;
  maxTokens?: number;
  noSafety: boolean;
  privacyMode: boolean;
  sessionId?: string;
  compactionTriggerUtilization: number;
  compactionTargetUtilization: number;
  turnCompactionTargetRatio: number;
  nonTurnTokenReserve: number;
}

export interface ConfigOverrides {
  stateDir?: string;
  promptsDir?: string;
  skillsDir?: string;
  provider?: string;
  model?: string;
  effort?: EffortLevel;
  mode?: HarnessMode;
  maxIterations?: number;
  snapshotEvery?: number;
  maxTokens?: number;
  noSafety?: boolean;
  privacyMode?: boolean;
  sessionId?: string;
  compactionTriggerUtilization?: number;
  compactionTargetUtilization?: number;
  turnCompactionTargetRatio?: number;
  nonTurnTokenReserve?: number;
}

interface FileConfig {
  stateDir?: string;
  promptsDir?: string;
  skillsDir?: string;
  provider?: string;
  model?: string;
  effort?: string;
  mode?: string;
  maxIterations?: number;
  snapshotEvery?: number;
  maxTokens?: number;
  noSafety?: boolean;
  privacyMode?: boolean;
  compactionTriggerUtilization?: number;
  compactionTargetUtilization?: number;
  turnCompactionTargetRatio?: number;
  nonTurnTokenReserve?: number;
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
    compactionTriggerUtilization: 0.85,
    compactionTargetUtilization: 0.7,
    turnCompactionTargetRatio: 0.75,
    nonTurnTokenReserve: 1_500,
  };

  const envStateDir = process.env.MH_STATE_DIR || process.env.MICRO_HARNESS_STATE_DIR;
  const envProvider = process.env.MH_PROVIDER || process.env.MICRO_HARNESS_PROVIDER;
  const envModel = process.env.MH_MODEL || process.env.MICRO_HARNESS_MODEL;
  const envEffort = parseEffort(process.env.MH_EFFORT || process.env.MICRO_HARNESS_EFFORT);
  const envMode = parseMode(process.env.MH_MODE || process.env.MICRO_HARNESS_MODE);
  const envMaxIterations = parseEnvPositiveInt(process.env.MH_MAX_ITERATIONS);
  const envSnapshotEvery = parseEnvPositiveInt(process.env.MH_SNAPSHOT_EVERY);
  const envCompactionTrigger = parseEnvRatio(process.env.MH_COMPACTION_TRIGGER);
  const envCompactionTarget = parseEnvRatio(process.env.MH_COMPACTION_TARGET);
  const envTurnCompactionTarget = parseEnvRatio(process.env.MH_TURN_COMPACTION_TARGET);
  const envNonTurnTokenReserve = parseEnvPositiveInt(process.env.MH_NON_TURN_TOKEN_RESERVE);

  return {
    stateDir: overrides.stateDir ?? envStateDir ?? fromFile.stateDir ?? defaults.stateDir,
    promptsDir: overrides.promptsDir ?? fromFile.promptsDir ?? defaults.promptsDir,
    skillsDir: overrides.skillsDir ?? fromFile.skillsDir,
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
    compactionTriggerUtilization:
      overrides.compactionTriggerUtilization ??
      envCompactionTrigger ??
      fromFile.compactionTriggerUtilization ??
      defaults.compactionTriggerUtilization,
    compactionTargetUtilization:
      overrides.compactionTargetUtilization ??
      envCompactionTarget ??
      fromFile.compactionTargetUtilization ??
      defaults.compactionTargetUtilization,
    turnCompactionTargetRatio:
      overrides.turnCompactionTargetRatio ??
      envTurnCompactionTarget ??
      fromFile.turnCompactionTargetRatio ??
      defaults.turnCompactionTargetRatio,
    nonTurnTokenReserve:
      overrides.nonTurnTokenReserve ??
      envNonTurnTokenReserve ??
      fromFile.nonTurnTokenReserve ??
      defaults.nonTurnTokenReserve,
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

function parseEnvRatio(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 0 || parsed > 1) return undefined;
  return parsed;
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
