import { type RunArgs, parseRunArgs, parseRunArgsWithPrompt } from "../args";
import { buildComposition } from "../composition";

export async function runCommand(args: string[], defaultPromptsDir: string): Promise<void> {
  const runArgs = parseRunArgs(args, defaultPromptsDir);
  await executeRun(runArgs);
}

export async function runCommandWithPrompt(
  args: string[],
  prompt: string,
  defaultPromptsDir: string,
): Promise<void> {
  const runArgs = parseRunArgsWithPrompt(args, prompt, defaultPromptsDir);
  await executeRun(runArgs);
}

async function executeRun(runArgs: RunArgs): Promise<void> {
  const composition = await buildComposition(runArgs);
  const userPlugins = await composition.loadUserPlugins();
  if (userPlugins.length > 0) {
    await composition.pluginHost.register(userPlugins);
  }

  const state = await composition.runtime.run(runArgs.agentName, runArgs.prompt, {
    maxIterations: runArgs.maxIterations,
    snapshotEvery: runArgs.snapshotEvery,
    profile: {
      defaultModel: runArgs.model ?? "",
      fastModel: runArgs.model,
    },
    modelOverride: runArgs.model,
    sessionId: runArgs.sessionId,
    resume: runArgs.resume,
    goal: runArgs.goal,
  });

  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}
