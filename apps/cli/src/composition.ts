import readline from "node:readline/promises";
import {
  type ApprovalHandler,
  type ApprovalRequest,
  CompositePolicyEngine,
  ContextManager,
  CredentialsRegistry,
  DefaultModelSelector,
  DefaultPolicyEngine,
  FsPromptSource,
  type HarnessPlugin,
  HarnessRuntime,
  InProcessSubagentRunner,
  MemoryEventSink,
  PluginHost,
  PluginLoader,
  ProviderModelAdapter,
  ProviderRegistry,
  SessionStore,
  type SubagentBuiltRuntime,
  type SubagentRunOptions,
  type SubagentRuntimeFactory,
  ToolRegistry,
  createCommandSafetyRule,
} from "@micro-harness/core";
import { exampleToolsPlugin } from "@micro-harness/plugin-example-tools";
import { subagentsPlugin } from "@micro-harness/plugin-subagents";
import { builtInProviderPlugins } from "@micro-harness/providers";
import type { RunArgs } from "./args";

export interface Composition {
  runtime: HarnessRuntime;
  pluginHost: PluginHost;
  sessionStore: SessionStore;
  loadUserPlugins(): Promise<HarnessPlugin[]>;
}

/**
 * Wires the full dependency graph for one `run` invocation. Registers the
 * built-in providers, example tools, and subagents plugin into the host;
 * loads any user plugin last so it can override built-in behavior.
 */
export async function buildComposition(runArgs: RunArgs): Promise<Composition> {
  const toolRegistry = new ToolRegistry();

  const context = new ContextManager({
    stateDir: runArgs.stateDir,
    maxWorkingTurns: 6,
    goal: runArgs.goal,
  });
  const prompts = new FsPromptSource({ rootDir: runArgs.promptsDir });

  const providerRegistry = new ProviderRegistry();
  const credentialsRegistry = new CredentialsRegistry();

  const policy = new CompositePolicyEngine(new DefaultPolicyEngine());
  if (!runArgs.noSafety) {
    policy.addRule(createCommandSafetyRule());
  }

  const sessionStore = new SessionStore(runArgs.stateDir);

  const runtime = new HarnessRuntime({
    model: new ProviderModelAdapter({
      providerRegistry,
      credentialsRegistry,
      providerId: runArgs.provider,
      model: runArgs.model,
    }),
    modelSelector: new DefaultModelSelector(),
    prompts,
    tools: toolRegistry,
    context,
    policy,
    eventSink: new MemoryEventSink(),
    sessionStore,
    approvalHandler: ttyApprovalHandler,
  });

  const subagentFactory: SubagentRuntimeFactory = {
    async build(request: SubagentRunOptions, parent): Promise<SubagentBuiltRuntime> {
      const childTools = new ToolRegistry();
      const parentTools = toolRegistry.list();
      const allow = request.allowedTools;
      for (const tool of parentTools) {
        if (tool.name === "spawn_subagent") continue;
        if (allow && !allow.includes(tool.name)) continue;
        childTools.register(tool);
      }

      const childContext = new ContextManager({
        stateDir: runArgs.stateDir,
        maxWorkingTurns: 6,
        goal: request.goal ?? request.prompt,
      });

      const childRuntime = new HarnessRuntime({
        model: new ProviderModelAdapter({
          providerRegistry,
          credentialsRegistry,
          providerId: runArgs.provider,
          model: runArgs.model,
        }),
        modelSelector: new DefaultModelSelector(),
        prompts,
        tools: childTools,
        context: childContext,
        policy,
        eventSink: new MemoryEventSink(),
        sessionStore,
        approvalHandler: ttyApprovalHandler,
      });

      return {
        runtime: childRuntime,
        agentName: request.agentName ?? runArgs.agentName,
        prompt: request.prompt,
        runOptions: {
          maxIterations: request.maxIterations ?? Math.min(4, runArgs.maxIterations),
          snapshotEvery: runArgs.snapshotEvery,
          profile: {
            defaultModel: runArgs.model ?? "",
            fastModel: runArgs.model,
          },
          modelOverride: runArgs.model,
          goal: request.goal ?? request.prompt,
          parentSessionId: parent.sessionId,
        },
      };
    },
  };

  const subagentRunner = new InProcessSubagentRunner(subagentFactory, runtime);

  const pluginHost = new PluginHost({
    tools: toolRegistry,
    providers: providerRegistry,
    credentials: credentialsRegistry,
    policy,
    onBeforeLoop: (hook) => runtime.addBeforeHook(hook),
    onAfterLoop: (hook) => runtime.addAfterHook(hook),
    setCompressor: (compressor) => runtime.setCompressor(compressor),
    setModelSelector: (selector) => runtime.setModelSelector(selector),
    subagents: subagentRunner,
  });

  await pluginHost.register([...builtInProviderPlugins(), exampleToolsPlugin, subagentsPlugin]);

  return {
    runtime,
    pluginHost,
    sessionStore,
    async loadUserPlugins(): Promise<HarnessPlugin[]> {
      if (!runArgs.pluginsPath) return [];
      const loader = new PluginLoader(process.cwd());
      return loader.load({ plugins: [runArgs.pluginsPath] });
    },
  };
}

export const ttyApprovalHandler: ApprovalHandler = async (request: ApprovalRequest) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      `[approval] Auto-denying "${request.tool.name}" (non-TTY): ${request.reason}\n`,
    );
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const payload = JSON.stringify(request.call.input);
    const preview = payload.length > 200 ? `${payload.slice(0, 200)}…` : payload;
    process.stdout.write(
      `\n[approval] Tool "${request.tool.name}" needs approval\n` +
        `  reason: ${request.reason}\n` +
        `  input:  ${preview}\n`,
    );
    const answer = (await rl.question("  approve? [y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
};
