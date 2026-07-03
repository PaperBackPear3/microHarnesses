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
  OllamaAdapter,
  OpenAIAdapter,
  PluginLoader,
  type ProviderId,
  ProviderModelAdapter,
  ProviderRegistry,
  SessionStore,
  ToolRegistry,
} from "@micro-harness/core";
import { echoTool } from "./tools/echo";
import { timeTool } from "./tools/time";

type Command = "run" | "sessions";

async function main(): Promise<void> {
  const [commandArg, ...rest] = process.argv.slice(2);
  const command = (commandArg as Command | undefined) ?? "run";

  if (command === "run") {
    await runCommand(rest);
    return;
  }

  if (command === "sessions") {
    await sessionsCommand(rest);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function runCommand(args: string[]): Promise<void> {
  const prompt = args.find((arg) => !arg.startsWith("--")) ?? "hello micro harness";
  await runWithOptions(args, prompt);
}

async function runWithOptions(args: string[], prompt: string): Promise<void> {
  const agentName = getArgValue(args, "--agent") ?? "default";
  const stateDir =
    getArgValue(args, "--state-dir") ?? path.resolve(process.cwd(), ".micro-harness");
  const promptDir = getArgValue(args, "--prompts-dir") ?? path.resolve(__dirname, "../prompts");
  const maxIterations = parsePositiveInt(getArgValue(args, "--iterations") ?? "4", "--iterations");
  const snapshotEvery = parsePositiveInt(
    getArgValue(args, "--snapshot-every") ?? "2",
    "--snapshot-every",
  );
  const pluginsPath = getArgValue(args, "--plugins");
  const provider = parseProvider(getArgValue(args, "--provider") ?? "openai");
  const model = getArgValue(args, "--model") ?? defaultModelFor(provider);
  const sessionId = getArgValue(args, "--session-id");
  const resume = hasFlag(args, "--resume");
  const goal = getArgValue(args, "--goal");

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(echoTool);
  toolRegistry.register(timeTool);

  const context = new ContextManager({
    stateDir,
    maxWorkingTurns: 6,
    goal,
  });
  const prompts = new FsPromptSource({ rootDir: promptDir });
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(new OpenAIAdapter());
  providerRegistry.register(new AnthropicAdapter());
  providerRegistry.register(new OllamaAdapter());
  const sessionStore = new SessionStore(stateDir);

  const runtime = new HarnessRuntime({
    model: new ProviderModelAdapter({
      providerRegistry,
      credentialsResolver: new EnvCredentialsResolver(),
      providerId: provider,
      model,
    }),
    modelSelector: new DefaultModelSelector(),
    prompts,
    tools: toolRegistry,
    context,
    spawner: new LocalProcessSpawner(path.resolve(__dirname, "worker.js")),
    policy: new DefaultPolicyEngine(),
    eventSink: new MemoryEventSink(),
    sessionStore,
  });

  if (pluginsPath) {
    const loader = new PluginLoader(process.cwd());
    const plugins = await loader.load({ plugins: [pluginsPath] });
    await runtime.registerPlugins(plugins);
  }

  const state = await runtime.run(agentName, prompt, {
    maxIterations,
    snapshotEvery,
    profile: {
      defaultModel: model,
      fastModel: model,
    },
    modelOverride: model,
    sessionId,
    resume,
    goal,
  });

  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function sessionsCommand(args: string[]): Promise<void> {
  const sub = args[0] ?? "list";
  const stateDir =
    getArgValue(args, "--state-dir") ?? path.resolve(process.cwd(), ".micro-harness");
  const sessionStore = new SessionStore(stateDir);

  if (sub === "list") {
    const sessions = await sessionStore.listSessions();
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return;
  }

  if (sub === "show") {
    const sessionId = args[1];
    if (!sessionId) {
      throw new Error("Usage: sessions show <session-id>");
    }
    const session = await sessionStore.getSession(sessionId);
    process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
    return;
  }

  if (sub === "resume") {
    const sessionId = args[1];
    if (!sessionId) {
      throw new Error("Usage: sessions resume <session-id> <prompt>");
    }
    const prompt = args[2] && !args[2].startsWith("--") ? args[2] : "continue from last state";
    const forwarded = [...args.slice(3), "--session-id", sessionId, "--resume"];
    await runWithOptions(forwarded, prompt);
    return;
  }

  throw new Error(`Unknown sessions subcommand: ${sub}`);
}

function getArgValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parsePositiveInt(raw: string, flagName: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function parseProvider(raw: string): ProviderId {
  if (raw === "openai" || raw === "anthropic" || raw === "ollama") {
    return raw;
  }
  throw new Error(`Unsupported provider "${raw}". Use "openai", "anthropic", or "ollama".`);
}

function defaultModelFor(provider: ProviderId): string {
  if (provider === "ollama") {
    return "llama3.2:3b";
  }
  return "gpt-4.1-mini";
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown fatal error";
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
