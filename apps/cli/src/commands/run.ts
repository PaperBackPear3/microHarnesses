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

  process.stderr.write(
    'Interactive mode. Type "/info" for session details, "/exit" or "/quit" to quit.\n',
  );
  while (true) {
    const prompt = (await askPrompt("you> ")).trim();
    if (prompt.length === 0) {
      continue;
    }
    const slashCommandResult = await runSlashCommand(
      prompt,
      composition,
      runArgs,
      sessionId,
      resume,
    );
    if (slashCommandResult === "exit") {
      break;
    }
    if (slashCommandResult === "handled") {
      continue;
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

type SlashCommandResult = "handled" | "exit" | "none";

async function runSlashCommand(
  prompt: string,
  composition: Composition,
  runArgs: RunArgs,
  sessionId: string | undefined,
  resume: boolean,
): Promise<SlashCommandResult> {
  if (!prompt.startsWith("/")) {
    return "none";
  }
  if (isExitPrompt(prompt)) {
    return "exit";
  }
  if (prompt.toLowerCase() === "/info") {
    await printSessionInfo(composition, runArgs, sessionId, resume);
    return "handled";
  }
  process.stderr.write('[info] Unknown command. Use "/info", "/exit", or "/quit".\n');
  return "handled";
}

async function printSessionInfo(
  composition: Composition,
  runArgs: RunArgs,
  sessionId: string | undefined,
  resume: boolean,
): Promise<void> {
  const model = runArgs.model ?? "provider default";
  const base = `[info] session=${sessionId ?? "unassigned"} agent=${runArgs.agentName} provider=${runArgs.provider} model=${model} resume=${resume ? "on" : "off"}`;

  if (!sessionId) {
    process.stderr.write(`${base}\n`);
    return;
  }

  try {
    const manifest = await composition.sessionStore.getSession(sessionId);
    const details = [
      `updated=${manifest.updatedAt}`,
      `events=${manifest.lastEventSeq}`,
      `latestRun=${manifest.latestRunId ?? "none"}`,
      `latestSnapshot=${manifest.latestSnapshotId ?? "none"}`,
    ];
    if (manifest.goal.length > 0) {
      details.push(`goal=${truncate(manifest.goal, 80)}`);
    }
    process.stderr.write(`${base} ${details.join(" ")}\n`);
  } catch {
    process.stderr.write(`${base} status=not-persisted-yet\n`);
  }
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

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
