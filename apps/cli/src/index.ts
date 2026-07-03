#!/usr/bin/env node

import path from "node:path";
import {
  AnthropicAdapter,
  ContextManager,
  DefaultModelSelector,
  DefaultPolicyEngine,
  EnvCredentialsResolver,
  FsPromptSource,
  HarnessRuntime,
  LocalProcessSpawner,
  MemoryEventSink,
  OpenAIAdapter,
  PluginLoader,
  ProviderModelAdapter,
  ProviderRegistry,
  ProviderId,
  ToolRegistry,
  echoTool,
  timeTool
} from "@micro-harness/core";

type Command = "run" | "checkpoints";

async function main(): Promise<void> {
  const [commandArg, ...rest] = process.argv.slice(2);
  const command = (commandArg as Command | undefined) ?? "run";

  if (command === "run") {
    await runCommand(rest);
    return;
  }

  if (command === "checkpoints") {
    await checkpointsCommand(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function runCommand(args: string[]): Promise<void> {
  const prompt = args.find((arg) => !arg.startsWith("--")) ?? "hello micro harness";
  const agentName = getArgValue(args, "--agent") ?? "default";
  const stateDir = getArgValue(args, "--state-dir") ?? path.resolve(process.cwd(), ".micro-harness");
  const promptDir = getArgValue(args, "--prompts-dir") ?? path.resolve(process.cwd(), "apps/cli/prompts");
  const maxIterations = Number(getArgValue(args, "--iterations") ?? "4");
  const checkpointEvery = Number(getArgValue(args, "--checkpoint-every") ?? "2");
  const pluginsPath = getArgValue(args, "--plugins");
  const provider = ((getArgValue(args, "--provider") ?? "openai") as ProviderId);
  const model = getArgValue(args, "--model") ?? "gpt-4.1-mini";

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(echoTool);
  toolRegistry.register(timeTool);

  const context = new ContextManager({
    stateDir,
    maxWorkingTurns: 6
  });
  const prompts = new FsPromptSource({ rootDir: promptDir });
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(new OpenAIAdapter());
  providerRegistry.register(new AnthropicAdapter());

  const runtime = new HarnessRuntime({
    model: new ProviderModelAdapter({
      providerRegistry,
      credentialsResolver: new EnvCredentialsResolver(),
      providerId: provider,
      model
    }),
    modelSelector: new DefaultModelSelector(),
    prompts,
    tools: toolRegistry,
    context,
    spawner: new LocalProcessSpawner(path.resolve(__dirname, "worker.js")),
    policy: new DefaultPolicyEngine(),
    eventSink: new MemoryEventSink()
  });

  if (pluginsPath) {
    const loader = new PluginLoader(process.cwd());
    const plugins = await loader.load({ plugins: [pluginsPath] });
    await runtime.registerPlugins(plugins);
  }

  const state = await runtime.run(agentName, prompt, {
    maxIterations,
    checkpointEvery,
    profile: {
      defaultModel: model,
      fastModel: model
    },
    modelProvider: provider
  });

  process.stdout.write(JSON.stringify(state, null, 2) + "\n");
}

async function checkpointsCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? "list";
  const stateDir = getArgValue(args, "--state-dir") ?? path.resolve(process.cwd(), ".micro-harness");
  const context = new ContextManager({
    stateDir,
    maxWorkingTurns: 6
  });
  await context.init();

  if (sub === "list") {
    const ids = await context.listCheckpoints();
    process.stdout.write(ids.join("\n") + (ids.length > 0 ? "\n" : ""));
    return;
  }

  if (sub === "show") {
    const id = args[1];
    if (!id) {
      throw new Error("Usage: checkpoints show <checkpoint-id>");
    }
    const state = await context.loadCheckpoint(id);
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
    return;
  }

  if (sub === "delete") {
    const id = args[1];
    if (!id) {
      throw new Error("Usage: checkpoints delete <checkpoint-id>");
    }
    await context.discardCheckpoint(id);
    process.stdout.write(`Deleted ${id}\n`);
    return;
  }

  throw new Error(`Unknown checkpoints subcommand: ${sub}`);
}

function getArgValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown fatal error";
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
