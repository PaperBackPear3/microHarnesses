import { type HarnessMode, parseMode } from "@micro-harnesses/core";
import { type EffortLevel, parseEffort } from "../config/config.js";

export interface GlobalCliArgs {
  prompt?: string;
  json: boolean;
  provider?: string;
  model?: string;
  effort?: EffortLevel;
  mode?: HarnessMode;
  sessionId?: string;
  stateDir?: string;
  promptsDir?: string;
  skillsDir?: string;
  noSafety: boolean;
  maxTokens?: number;
  maxIterations?: number | "unlimited";
  snapshotEvery?: number;
  compactionTriggerUtilization?: number;
  compactionTargetUtilization?: number;
  turnCompactionTargetRatio?: number;
  nonTurnTokenReserve?: number;
}

export interface SessionsArgs {
  sub: "list" | "show";
  stateDir?: string;
  sessionId?: string;
}

const VALUE_FLAGS = new Set([
  "-p",
  "--print",
  "--provider",
  "--model",
  "--effort",
  "--mode",
  "--session",
  "--session-id",
  "--state-dir",
  "--prompts-dir",
  "--skills-dir",
  "--max-tokens",
  "--iterations",
  "--snapshot-every",
  "--compaction-trigger",
  "--compaction-target",
  "--turn-compaction-target",
  "--non-turn-token-reserve",
]);

export function parseGlobalCliArgs(args: string[]): GlobalCliArgs {
  const prompt = getValue(args, "-p") ?? getValue(args, "--print");
  const effortRaw = getValue(args, "--effort");
  const modeRaw = getValue(args, "--mode");

  return {
    prompt,
    json: hasFlag(args, "--json"),
    provider: getValue(args, "--provider"),
    model: getValue(args, "--model"),
    effort: parseEffort(effortRaw),
    mode: parseMode(modeRaw),
    sessionId: getValue(args, "--session") ?? getValue(args, "--session-id"),
    stateDir: getValue(args, "--state-dir"),
    promptsDir: getValue(args, "--prompts-dir"),
    skillsDir: getValue(args, "--skills-dir"),
    noSafety: hasFlag(args, "--no-safety"),
    maxTokens: parseOptionalInt(getValue(args, "--max-tokens"), "--max-tokens"),
    maxIterations: parseIterationLimit(getValue(args, "--iterations"), "--iterations"),
    snapshotEvery: parseOptionalInt(getValue(args, "--snapshot-every"), "--snapshot-every"),
    compactionTriggerUtilization: parseOptionalRatio(
      getValue(args, "--compaction-trigger"),
      "--compaction-trigger",
    ),
    compactionTargetUtilization: parseOptionalRatio(
      getValue(args, "--compaction-target"),
      "--compaction-target",
    ),
    turnCompactionTargetRatio: parseOptionalRatio(
      getValue(args, "--turn-compaction-target"),
      "--turn-compaction-target",
    ),
    nonTurnTokenReserve: parseOptionalInt(
      getValue(args, "--non-turn-token-reserve"),
      "--non-turn-token-reserve",
    ),
  };
}

export function parseSessionsArgs(args: string[]): SessionsArgs {
  const subRaw = (args[0] ?? "list").toLowerCase();
  const sub = subRaw === "show" ? "show" : "list";
  const sessionId = sub === "show" ? args[1] : undefined;
  return {
    sub,
    sessionId,
    stateDir: getValue(args, "--state-dir"),
  };
}

function getValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseOptionalInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseIterationLimit(
  raw: string | undefined,
  flag: string,
): number | "unlimited" | undefined {
  if (raw === undefined) return undefined;
  if (raw.trim().toLowerCase() === "unlimited") return "unlimited";
  return parseOptionalInt(raw, flag);
}

function parseOptionalRatio(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${flag} must be a number between 0 and 1`);
  }
  return parsed;
}

export function extractPositionals(args: string[]): string[] {
  const output: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      if (VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    output.push(arg);
  }
  return output;
}
