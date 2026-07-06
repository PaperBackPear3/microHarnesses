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
  InProcessSubagentSupervisor,
  JsonlObservabilityExporter,
  PluginHost,
  ProviderRegistry,
  type RunOptions,
  type SessionStore,
  type SubagentSupervisor,
  ToolRegistry,
  builtInProviderPlugins,
  createCommandSafetyRule,
  createCoreDefaultTools,
  registerCoreDefaults,
} from "@micro-harnesses/core";
import { AgenticCompressionPlugin } from "@micro-harnesses/plugin-agentic-compression";
import { BasicToolsPlugin } from "@micro-harnesses/plugin-basic-tools";
import { exampleToolsPlugin } from "@micro-harnesses/plugin-example-tools";
import { PlanModePlugin } from "@micro-harnesses/plugin-plan-mode";
import type { CliConfig, EffortLevel } from "../config/config";
import { modelForEffort, profileForProvider } from "../config/providers";
import { ModeController } from "../modes/modes";
import { SessionService } from "../session/sessionService";
import { UiStream } from "../streaming/uiStream";
import { ApprovalController } from "./approvalHandler";
import { createModeAwareApprovalPolicy, planModeAllowActions } from "./approvalPolicy";
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_OLLAMA_CONTEXT_WINDOW_TOKENS,
  detectOllamaContextWindowTokens,
} from "./contextWindow";
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
  refreshContextWindowTokens(): Promise<{
    tokens: number;
    provider: string;
    model: string;
    source: "default" | "ollama-api" | "ollama-fallback";
  }>;
  runOptions(): RunOptions;
  sessionStore: SessionStore;
  subagents: SubagentSupervisor;
}

const COMPRESSION_TRIGGER_UTILIZATION = 0.7;
const COMPRESSION_TARGET_UTILIZATION = 0.45;
const TURN_COMPACTION_TARGET_RATIO = 0.75;
const NON_TURN_TOKEN_RESERVE = 1_500;

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
    resource: { serviceName: "micro-harness-cli", serviceVersion: "2.0.0" },
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

  let contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS;
  const context = new ContextManager({
    stateDir: path.join(config.stateDir, "sessions", rootSessionId, "context"),
    maxWorkingTurns: 16,
    goal: "",
    contextWindowTokens,
    compressionTriggerUtilization: COMPRESSION_TRIGGER_UTILIZATION,
    compressionTargetUtilization: COMPRESSION_TARGET_UTILIZATION,
    turnCompactionTargetRatio: TURN_COMPACTION_TARGET_RATIO,
    nonTurnTokenReserve: NON_TURN_TOKEN_RESERVE,
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

  const subagents = new InProcessSubagentSupervisor(
    {
      async build(request, parent) {
        const childSessionId = `s-${randomUUID()}`;
        const childTools = new ToolRegistry();
        for (const tool of tools.list()) {
          if (tool.name === "spawn_subagent") continue;
          if (tool.name === "wait_subagents") continue;
          if (request.allowedTools && !request.allowedTools.includes(tool.name)) continue;
          childTools.register(tool);
        }
        const childContext = new ContextManager({
          stateDir: path.join(config.stateDir, "sessions", childSessionId, "context"),
          maxWorkingTurns: 6,
          goal: request.goal ?? request.prompt,
          contextWindowTokens,
          compressionTriggerUtilization: COMPRESSION_TRIGGER_UTILIZATION,
          compressionTargetUtilization: COMPRESSION_TARGET_UTILIZATION,
          turnCompactionTargetRatio: TURN_COMPACTION_TARGET_RATIO,
          nonTurnTokenReserve: NON_TURN_TOKEN_RESERVE,
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
            maxIterations: request.maxIterations ?? Math.min(8, config.maxIterations),
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
      subagents,
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
    subagents,
    invokeAgent: (request) => agent.invoke(request),
  });

  await pluginHost.register([
    ...builtInProviderPlugins(),
    new BasicToolsPlugin({ rootDir: process.cwd() }),
    new PlanModePlugin({ rootDir: process.cwd() }),
    new AgenticCompressionPlugin(),
    exampleToolsPlugin,
  ]);

  async function refreshContextWindowTokens(): Promise<{
    tokens: number;
    provider: string;
    model: string;
    source: "default" | "ollama-api" | "ollama-fallback";
  }> {
    const provider = runtimeState.provider;
    const profile = profileForProvider(provider, runtimeState.model);
    const model = runtimeState.model ?? modelForEffort(profile, runtimeState.effort);
    let source: "default" | "ollama-api" | "ollama-fallback" = "default";
    let tokens = DEFAULT_CONTEXT_WINDOW_TOKENS;

    if (provider === "ollama") {
      source = "ollama-fallback";
      tokens = DEFAULT_OLLAMA_CONTEXT_WINDOW_TOKENS;
      try {
        const auth = await credentials.get("ollama").resolve();
        const detected = await detectOllamaContextWindowTokens({
          baseUrl: auth.baseUrl ?? "http://127.0.0.1:11434/v1",
          model,
        });
        if (detected && detected > 0) {
          tokens = detected;
          source = "ollama-api";
        }
      } catch {
        // Keep conservative fallback for local models when detection is unavailable.
      }
    }

    contextWindowTokens = tokens;
    agent.setContextWindowTokens(tokens);
    return { tokens, provider, model, source };
  }

  await refreshContextWindowTokens();

  return {
    agent,
    uiStream,
    modeController,
    approvalController,
    modelSelector,
    sessionService,
    rootSessionId,
    runtimeState,
    refreshContextWindowTokens,
    sessionStore,
    subagents,
    runOptions() {
      const mode = modeController.getMode();
      const maxIterations =
        mode === "autopilot" ? Math.max(config.maxIterations, 48) : config.maxIterations;
      return {
        maxIterations,
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
