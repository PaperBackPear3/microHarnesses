import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  Agent,
  CompositePolicyEngine,
  ContextManager,
  CredentialsRegistry,
  DefaultObservabilityProvider,
  DefaultPolicyEngine,
  FsPromptSource,
  InProcessSubagentRunner,
  JsonlObservabilityExporter,
  PluginHost,
  ProviderRegistry,
  type RunOptions,
  type SessionStore,
  ToolRegistry,
  builtInProviderPlugins,
  createCommandSafetyRule,
  createCoreDefaultTools,
  registerCoreDefaults,
} from "@micro-harnesses/core";
import { BasicToolsPlugin } from "@micro-harnesses/plugin-basic-tools";
import { exampleToolsPlugin } from "@micro-harnesses/plugin-example-tools";
import { PlanModePlugin } from "@micro-harnesses/plugin-plan-mode";
import type { CliConfig, EffortLevel } from "../config/config";
import { profileForProvider } from "../config/providers";
import { ModeController } from "../modes/modes";
import { SessionService } from "../session/sessionService";
import { UiStream } from "../streaming/uiStream";
import { ApprovalController } from "./approvalHandler";
import { createModeAwareApprovalPolicy, planModeAllowActions } from "./approvalPolicy";
import { EffortModelSelector } from "./modelSelector";
import { RuntimeModelAdapter } from "./runtimeModelAdapter";

export interface RuntimeState {
  provider: string;
  model?: string;
  effort: EffortLevel;
}

export interface CliComposition {
  agent: Agent;
  uiStream: UiStream;
  modeController: ModeController;
  approvalController: ApprovalController;
  modelSelector: EffortModelSelector;
  sessionService: SessionService;
  rootSessionId: string;
  runtimeState: RuntimeState;
  runOptions(): RunOptions;
  sessionStore: SessionStore;
}

export async function buildComposition(
  config: CliConfig,
  sessionIdOverride?: string,
): Promise<CliComposition> {
  const rootSessionId = sessionIdOverride ?? config.sessionId ?? `s-${randomUUID()}`;
  const runtimeState: RuntimeState = {
    provider: config.provider,
    model: config.model,
    effort: config.effort,
  };

  const modeController = new ModeController(config.mode);
  const approvalController = new ApprovalController(process.cwd());
  const uiStream = new UiStream();
  const telemetryExporter = new JsonlObservabilityExporter({
    dir: path.join(config.stateDir, "sessions", rootSessionId, "telemetry"),
  });

  const observability = new DefaultObservabilityProvider({
    resource: { serviceName: "micro-harness-cli", serviceVersion: "1.0.0" },
    stream: uiStream,
    traceExporters: [telemetryExporter],
    metricExporters: [telemetryExporter],
    logExporters: [telemetryExporter],
    redaction: {
      privacyMode: config.privacyMode,
    },
  });

  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const tools = new ToolRegistry();
  const policy = new CompositePolicyEngine(
    new DefaultPolicyEngine({
      allowedHighRiskTools: [
        "fs_write",
        "fs_append",
        "fs_mkdir",
        "fs_move",
        "fs_remove",
        "shell_exec",
        "spawn_subagent",
      ],
    }),
  );
  policy.addRule(createModeAwareApprovalPolicy(modeController));
  if (!config.noSafety) {
    policy.addRule(createCommandSafetyRule());
  }

  const context = new ContextManager({
    stateDir: path.join(config.stateDir, "sessions", rootSessionId, "context"),
    maxWorkingTurns: 8,
    goal: "",
    contextWindowTokens: 128_000,
  });
  const prompts = new FsPromptSource({ rootDir: config.promptsDir });
  const modelSelector = new EffortModelSelector(runtimeState.effort);
  const model = new RuntimeModelAdapter(providers, credentials, () => ({
    provider: runtimeState.provider,
    model: runtimeState.model,
    maxTokens: config.maxTokens,
  }));

  const sessionService = new SessionService(config.stateDir);
  const sessionStore = sessionService.getStore();

  const agent = new Agent({
    promptName: "coder",
    model,
    modelSelector,
    prompts,
    tools,
    context,
    policy,
    observability,
    sessionStore,
    approvalHandler: approvalController.createHandler(() => modeController.getMode()),
  });

  const subagentRunner = new InProcessSubagentRunner(
    {
      async build(request, parent) {
        const childSessionId = `s-${randomUUID()}`;
        const childTools = new ToolRegistry();
        for (const tool of tools.list()) {
          if (tool.name === "spawn_subagent") continue;
          if (request.allowedTools && !request.allowedTools.includes(tool.name)) continue;
          childTools.register(tool);
        }
        const childContext = new ContextManager({
          stateDir: path.join(config.stateDir, "sessions", childSessionId, "context"),
          maxWorkingTurns: 6,
          goal: request.goal ?? request.prompt,
          contextWindowTokens: 128_000,
        });
        const childAgent = new Agent({
          promptName: request.promptName ?? "coder",
          model,
          modelSelector,
          prompts,
          tools: childTools,
          context: childContext,
          policy,
          observability,
          sessionStore,
          approvalHandler: approvalController.createHandler(() => modeController.getMode()),
          kind: "subagent",
        });
        return {
          agent: childAgent,
          prompt: request.prompt,
          runOptions: {
            maxIterations: request.maxIterations ?? Math.min(4, config.maxIterations),
            snapshotEvery: config.snapshotEvery,
            profile: profileForProvider(runtimeState.provider, runtimeState.model),
            modelOverride: runtimeState.model,
            sessionId: childSessionId,
            goal: request.goal ?? request.prompt,
            parentSessionId: parent.sessionId,
            rootSessionId: rootSessionId,
            parentTrace: request.parentTrace,
            depth: 1,
          },
        };
      },
    },
    agent,
  );

  registerCoreDefaults({
    providerRegistry: providers,
    credentialsRegistry: credentials,
    toolRegistry: tools,
    includeBuiltInProviders: false,
    tools: createCoreDefaultTools({
      workspaceTools: { rootDir: process.cwd() },
      subagents: subagentRunner,
    }),
  });

  const pluginHost = new PluginHost({
    tools,
    providers,
    credentials,
    policy,
    onBeforeLoop: (hook) => agent.addBeforeHook(hook),
    onAfterLoop: (hook) => agent.addAfterHook(hook),
    setCompressor: (compressor) => agent.setCompressor(compressor),
    setModelSelector: (selector) => agent.setModelSelector(selector),
    observability: {
      tracer: observability.tracer,
      meter: observability.meter,
      logger: observability.logger,
      registerTraceExporter: (exporter) => observability.addTraceExporter(exporter),
      registerMetricExporter: (exporter) => observability.addMetricExporter(exporter),
      registerLogExporter: (exporter) => observability.addLogExporter(exporter),
    },
    subagents: subagentRunner,
    invokeAgent: (request) => agent.invoke(request),
  });

  await pluginHost.register([
    ...builtInProviderPlugins(),
    new BasicToolsPlugin({ rootDir: process.cwd() }),
    new PlanModePlugin({ rootDir: process.cwd() }),
    exampleToolsPlugin,
  ]);

  return {
    agent,
    uiStream,
    modeController,
    approvalController,
    modelSelector,
    sessionService,
    rootSessionId,
    runtimeState,
    sessionStore,
    runOptions() {
      const mode = modeController.getMode();
      return {
        maxIterations: config.maxIterations,
        snapshotEvery: config.snapshotEvery,
        profile: profileForProvider(runtimeState.provider, runtimeState.model),
        modelOverride: runtimeState.model,
        sessionId: rootSessionId,
        resume: true,
        capabilityScope: mode === "plan" ? { allowActions: planModeAllowActions() } : undefined,
      };
    },
  };
}
