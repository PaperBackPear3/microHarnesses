import {
  type HarnessMode,
  type ModelRoutingPreference,
  type RuntimeStateMachineEnforcement,
  type RuntimeStateMachineProfileName,
  parseMode,
  parseModelRoutingPreference,
  parseStateMachineEnforcement,
  parseStateMachineProfile,
} from "@micro-harnesses/core";
import { type EffortLevel, parseEffort } from "../config/config.js";
import {
  parseIterationLimit,
  parsePositiveInteger,
  parseRatio,
  throwOnInvalid,
} from "../config/valueParsers.js";

export interface GlobalCliArgs {
  prompt?: string;
  json: boolean;
  provider?: string;
  model?: string;
  effort?: EffortLevel;
  routingPreference?: ModelRoutingPreference;
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
  stateMachineEnforcement?: RuntimeStateMachineEnforcement;
  stateMachineProfile?: RuntimeStateMachineProfileName;
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
  "--routing-preference",
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
  "--state-machine",
  "--state-machine-profile",
]);

export function parseGlobalCliArgs(args: string[]): GlobalCliArgs {
  const prompt = getFirstValue(args, ["--print", "-p"]);
  const effortRaw = getValue(args, "--effort");
  const modeRaw = getValue(args, "--mode");

  return {
    prompt,
    json: hasFlag(args, "--json"),
    provider: getValue(args, "--provider"),
    model: getValue(args, "--model"),
    effort: parseEffort(effortRaw),
    routingPreference: parseModelRoutingPreference(getValue(args, "--routing-preference")),
    mode: parseMode(modeRaw),
    sessionId: getFirstValue(args, ["--session-id", "--session"]),
    stateDir: getValue(args, "--state-dir"),
    promptsDir: getValue(args, "--prompts-dir"),
    skillsDir: getValue(args, "--skills-dir"),
    noSafety: hasFlag(args, "--no-safety"),
    maxTokens: parsePositiveInteger(getValue(args, "--max-tokens"), throwOnInvalid("--max-tokens")),
    maxIterations: parseIterationLimit(
      getValue(args, "--iterations"),
      throwOnInvalid("--iterations"),
    ),
    snapshotEvery: parsePositiveInteger(
      getValue(args, "--snapshot-every"),
      throwOnInvalid("--snapshot-every"),
    ),
    compactionTriggerUtilization: parseRatio(
      getValue(args, "--compaction-trigger"),
      throwOnInvalid("--compaction-trigger"),
    ),
    compactionTargetUtilization: parseRatio(
      getValue(args, "--compaction-target"),
      throwOnInvalid("--compaction-target"),
    ),
    turnCompactionTargetRatio: parseRatio(
      getValue(args, "--turn-compaction-target"),
      throwOnInvalid("--turn-compaction-target"),
    ),
    nonTurnTokenReserve: parsePositiveInteger(
      getValue(args, "--non-turn-token-reserve"),
      throwOnInvalid("--non-turn-token-reserve"),
    ),
    stateMachineEnforcement: parseStateMachineEnforcement(getValue(args, "--state-machine")),
    stateMachineProfile: parseStateMachineProfile(getValue(args, "--state-machine-profile")),
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

function getFirstValue(args: string[], names: string[]): string | undefined {
  for (const name of names) {
    const value = getValue(args, name);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
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
