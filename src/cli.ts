#!/usr/bin/env node

import path from "node:path";
import { ContextManager } from "./context/manager";
import { HarnessRuntime } from "./core/runtime";
import { LocalProcessSpawner } from "./agents/localSpawner";
import { RuleBasedAdapter } from "./model/ruleBasedAdapter";
import { PluginLoader } from "./plugins/loader";
import { echoTool } from "./tools/builtin/echo";
import { timeTool } from "./tools/builtin/time";
import { ToolRegistry } from "./tools/registry";

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
  const stateDir = getArgValue(args, "--state-dir") ?? path.resolve(process.cwd(), ".micro-harness");
  const maxIterations = Number(getArgValue(args, "--iterations") ?? "4");
  const checkpointEvery = Number(getArgValue(args, "--checkpoint-every") ?? "2");
  const pluginsPath = getArgValue(args, "--plugins");

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(echoTool);
  toolRegistry.register(timeTool);

  const context = new ContextManager({
    stateDir,
    maxWorkingTurns: 6
  });

  const runtime = new HarnessRuntime({
    model: new RuleBasedAdapter(),
    tools: toolRegistry,
    context,
    spawner: new LocalProcessSpawner(path.resolve(__dirname, "agents/worker.js"))
  });

  if (pluginsPath) {
    const loader = new PluginLoader(process.cwd());
    const plugins = await loader.load({ plugins: [pluginsPath] });
    await runtime.registerPlugins(plugins);
  }

  const state = await runtime.run(prompt, {
    maxIterations,
    checkpointEvery
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
