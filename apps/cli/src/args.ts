export interface RunArgs {
  prompt: string;
  agentName: string;
  stateDir: string;
  promptsDir: string;
  maxIterations: number;
  snapshotEvery: number;
  pluginsPath?: string;
  provider: string;
  model?: string;
  maxTokens?: number;
  sessionId?: string;
  resume: boolean;
  goal?: string;
  noSafety: boolean;
}

export interface SessionsArgs {
  sub: string;
  stateDir: string;
  sessionId?: string;
  resumePrompt?: string;
  extraArgs: string[];
}

const DEFAULT_PROVIDER = "openai";

const VALUE_FLAGS = new Set([
  "--agent",
  "--state-dir",
  "--prompts-dir",
  "--iterations",
  "--snapshot-every",
  "--plugins",
  "--provider",
  "--model",
  "--max-tokens",
  "--session-id",
  "--goal",
]);

export function parseRunArgs(args: string[], defaultPromptsDir: string): RunArgs {
  const prompt = extractPositionalArgs(args)[0] ?? "";
  return parseRunArgsWithPrompt(args, prompt, defaultPromptsDir);
}

export function parseRunArgsWithPrompt(
  args: string[],
  prompt: string,
  defaultPromptsDir: string,
): RunArgs {
  return {
    prompt,
    agentName: getArgValue(args, "--agent") ?? "default",
    stateDir: getArgValue(args, "--state-dir") ?? `${process.cwd()}/.micro-harness`,
    promptsDir: getArgValue(args, "--prompts-dir") ?? defaultPromptsDir,
    maxIterations: parsePositiveInt(getArgValue(args, "--iterations") ?? "4", "--iterations"),
    snapshotEvery: parsePositiveInt(
      getArgValue(args, "--snapshot-every") ?? "2",
      "--snapshot-every",
    ),
    pluginsPath: getArgValue(args, "--plugins"),
    provider: getArgValue(args, "--provider") ?? DEFAULT_PROVIDER,
    model: getArgValue(args, "--model"),
    maxTokens: parseOptionalPositiveInt(getArgValue(args, "--max-tokens"), "--max-tokens"),
    sessionId: getArgValue(args, "--session-id"),
    resume: hasFlag(args, "--resume"),
    goal: getArgValue(args, "--goal"),
    noSafety: hasFlag(args, "--no-safety"),
  };
}

export function parseSessionsArgs(args: string[]): SessionsArgs {
  return {
    sub: args[0] ?? "list",
    stateDir: getArgValue(args, "--state-dir") ?? `${process.cwd()}/.micro-harness`,
    sessionId: args[1],
    resumePrompt: args[2] && !args[2].startsWith("--") ? args[2] : undefined,
    extraArgs: args.slice(3),
  };
}

export function getArgValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function parsePositiveInt(raw: string, flagName: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function parseOptionalPositiveInt(raw: string | undefined, flagName: string): number | undefined {
  if (typeof raw === "undefined") {
    return undefined;
  }
  return parsePositiveInt(raw, flagName);
}

export function extractPositionalArgs(args: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value.startsWith("--")) {
      if (VALUE_FLAGS.has(value)) {
        index += 1;
      }
      continue;
    }
    positionals.push(value);
  }
  return positionals;
}
