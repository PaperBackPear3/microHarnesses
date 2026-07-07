import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type EffortLevel,
  type HarnessMode,
  type ModelRoutingPreference,
  parseEffort,
  parseMode,
  parseModelRoutingPreference,
} from "@micro-harnesses/core";
import {
  IGNORE_INVALID_PARSE,
  parseIterationLimit,
  parsePositiveInteger,
  parseRatio,
} from "./valueParsers.js";

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
  /** Optional router preference (`auto|cost|speed|intelligence|balanced`); unset keeps effort-based profile selection. */
  routingPreference?: ModelRoutingPreference;
  mode: HarnessMode;
  maxIterations: number;
  unlimitedIterations: boolean;
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
  routingPreference?: ModelRoutingPreference;
  mode?: HarnessMode;
  maxIterations?: number | "unlimited";
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
  routingPreference?: string;
  mode?: string;
  maxIterations?: number | "unlimited";
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
    promptsDir: fileURLToPath(new URL("../../prompts", import.meta.url)),
    provider: "openai",
    effort: "medium",
    mode: "accept-edits",
    maxIterations: 320,
    unlimitedIterations: false,
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
  const envRoutingPreference = parseModelRoutingPreference(
    process.env.MH_ROUTING_PREFERENCE || process.env.MICRO_HARNESS_ROUTING_PREFERENCE,
  );
  const envMode = parseMode(process.env.MH_MODE || process.env.MICRO_HARNESS_MODE);
  const envMaxIterations =
    parseIterationLimit(process.env.MH_MAX_ITERATIONS, IGNORE_INVALID_PARSE) ??
    parseIterationLimit(process.env.MICRO_HARNESS_MAX_ITERATIONS, IGNORE_INVALID_PARSE);
  const envSnapshotEvery = parsePositiveInteger(
    process.env.MH_SNAPSHOT_EVERY,
    IGNORE_INVALID_PARSE,
  );
  const envCompactionTrigger = parseRatio(process.env.MH_COMPACTION_TRIGGER, IGNORE_INVALID_PARSE);
  const envCompactionTarget = parseRatio(process.env.MH_COMPACTION_TARGET, IGNORE_INVALID_PARSE);
  const envTurnCompactionTarget = parseRatio(
    process.env.MH_TURN_COMPACTION_TARGET,
    IGNORE_INVALID_PARSE,
  );
  const envNonTurnTokenReserve = parsePositiveInteger(
    process.env.MH_NON_TURN_TOKEN_RESERVE,
    IGNORE_INVALID_PARSE,
  );

  const overrideIterations = overrides.maxIterations;
  const fileIterations = fromFile.maxIterations;
  const resolvedIterationSetting =
    overrideIterations ?? fileIterations ?? envMaxIterations ?? defaults.maxIterations;
  const unlimitedIterations = resolvedIterationSetting === "unlimited";

  return {
    stateDir: overrides.stateDir ?? envStateDir ?? fromFile.stateDir ?? defaults.stateDir,
    promptsDir: overrides.promptsDir ?? fromFile.promptsDir ?? defaults.promptsDir,
    skillsDir: overrides.skillsDir ?? fromFile.skillsDir,
    provider: overrides.provider ?? envProvider ?? fromFile.provider ?? defaults.provider,
    model: overrides.model ?? envModel ?? fromFile.model ?? defaults.model,
    effort: overrides.effort ?? envEffort ?? parseEffort(fromFile.effort) ?? defaults.effort,
    routingPreference:
      overrides.routingPreference ??
      envRoutingPreference ??
      parseModelRoutingPreference(fromFile.routingPreference),
    mode: overrides.mode ?? envMode ?? parseMode(fromFile.mode) ?? defaults.mode,
    maxIterations:
      resolvedIterationSetting === "unlimited" ? defaults.maxIterations : resolvedIterationSetting,
    unlimitedIterations,
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

async function readConfigFile(): Promise<FileConfig> {
  const configPath = path.join(os.homedir(), ".microharness", "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as FileConfig;
  } catch {
    return {};
  }
}
