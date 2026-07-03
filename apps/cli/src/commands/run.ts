import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { type RunArgs, parseRunArgs, parseRunArgsWithPrompt } from "../args";
import { type Composition, buildComposition } from "../composition";

export async function runCommand(args: string[], defaultPromptsDir: string): Promise<void> {
  const runArgs = ensureSessionId(parseRunArgs(args, defaultPromptsDir));
  if (runArgs.prompt.trim().length === 0) {
    await runInteractiveLoop(runArgs);
    return;
  }
  await runSinglePrompt(runArgs, runArgs.prompt);
}

export async function runCommandWithPrompt(
  args: string[],
  prompt: string,
  defaultPromptsDir: string,
): Promise<void> {
  const runArgs = ensureSessionId(parseRunArgsWithPrompt(args, prompt, defaultPromptsDir));
  await runSinglePrompt(runArgs, prompt);
}

async function runSinglePrompt(runArgs: RunArgs, prompt: string): Promise<void> {
  const composition = await prepareComposition(runArgs);
  try {
    await executePrompt(composition, runArgs, prompt, runArgs.sessionId, runArgs.resume);
  } catch (error: unknown) {
    composition.liveEventSink.reset();
    throw error;
  }
}

async function runInteractiveLoop(runArgs: RunArgs): Promise<void> {
  const composition = await prepareComposition(runArgs);
  let sessionId = runArgs.sessionId;
  let resume = runArgs.resume;

  process.stderr.write('Interactive mode. Type "/exit" or "/quit" to quit.\n');
  while (true) {
    const prompt = (await askPrompt("you> ")).trim();
    if (prompt.length === 0) {
      continue;
    }
    if (isExitPrompt(prompt)) {
      break;
    }
    try {
      sessionId = await executePrompt(composition, runArgs, prompt, sessionId, resume);
      resume = true;
    } catch (error: unknown) {
      composition.liveEventSink.reset();
      const message = error instanceof Error ? error.message : "unknown run error";
      process.stderr.write(`[error] ${message}\n`);
    }
  }
}

async function prepareComposition(runArgs: RunArgs): Promise<Composition> {
  const composition = await buildComposition(runArgs);
  const userPlugins = await composition.loadUserPlugins();
  if (userPlugins.length > 0) {
    await composition.pluginHost.register(userPlugins);
  }
  return composition;
}

async function executePrompt(
  composition: Composition,
  runArgs: RunArgs,
  prompt: string,
  sessionId: string | undefined,
  resume: boolean,
): Promise<string | undefined> {
  const state = await composition.runtime.run(runArgs.agentName, prompt, {
    maxIterations: runArgs.maxIterations,
    snapshotEvery: runArgs.snapshotEvery,
    profile: {
      defaultModel: runArgs.model ?? "",
      fastModel: runArgs.model,
      reasoningModel: runArgs.model,
    },
    modelOverride: runArgs.model,
    sessionId,
    resume,
    goal: runArgs.goal,
  });
  return state.sessionId;
}

async function askPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function isExitPrompt(prompt: string): boolean {
  const lowered = prompt.toLowerCase();
  return lowered === "/exit" || lowered === "/quit";
}

function ensureSessionId(runArgs: RunArgs): RunArgs {
  if (runArgs.sessionId) {
    return runArgs;
  }
  return {
    ...runArgs,
    sessionId: `s-${randomUUID()}`,
  };
}
