import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  type Agent,
  CompositePolicyEngine,
  ContextManager,
  CredentialsRegistry,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_OLLAMA_CONTEXT_WINDOW_TOKENS,
  DefaultModelRouter,
  DefaultObservabilityProvider,
  DefaultPolicyEngine,
  type EffortLevel,
  EffortModelSelector,
  FsPromptSource,
  FsSkillSource,
  HeuristicTokenCounter,
  InProcessSubagentSupervisor,
  JsonlObservabilityExporter,
  ModeController,
  type ModelRoute,
  type ModelRoutingPreference,
  PluginHost,
  type ProviderAuth,
  ProviderModelAdapter,
  ProviderRegistry,
  type RunOptions,
  type SessionStore,
  SkillRegistry,
  type SubagentSupervisor,
  type TokenCounter,
  ToolRegistry,
  builtInProviderPlugins,
  createAgenticCompressor,
  createCommandSafetyRule,
  createCoreDefaultTools,
  createModeAwareApprovalPolicy,
  defineAgent,
  detectOllamaContextWindowTokens,
  discoverProviderRoutes,
  mergeProviderRoutes,
  modelForEffort,
  planModeAllowActions,
  profileForProvider,
  registerCoreDefaults,
  routesForProviderProfile,
} from "@micro-harnesses/core";
import { BasicToolsPlugin } from "@micro-harnesses/plugin-basic-tools";
import { exampleToolsPlugin } from "@micro-harnesses/plugin-example-tools";
import type { CliConfig } from "../config/config.js";
import { SessionService } from "../session/sessionService.js";
import { UiStream } from "../streaming/uiStream.js";
import { CLI_VERSION } from "../version.js";
import { ApprovalController } from "./approvalHandler.js";
import { resolveSubagentPromptName } from "./subagentPromptName.js";

export interface RuntimeState {
  provider: string;
  model?: string;
  effort: EffortLevel;
  /** When set, the agent routes model selection via `ModelRouter` instead of the static profile. */
  routingPreference?: ModelRoutingPreference;
}

export interface CliComposition {
  agent: Agent;
  uiStream: UiStream;
  modeController: ModeController;
  approvalController: ApprovalController;
  modelSelector: EffortModelSelector;
  sessionService: SessionService;
  rootSessionId: string;
  cliVersion: string;
  runtimeState: RuntimeState;
  refreshContextWindowTokens(): Promise<{
    tokens: number;
    provider: string;
    model: string;
    source: "default" | "ollama-api" | "ollama-fallback";
    estimator: string;
  }>;
  runOptions(): RunOptions;
  sessionStore: SessionStore;
  subagents: SubagentSupervisor;
  /** Current cached route catalog across all registered providers with resolvable credentials (profile routes merged with discovery). */
  listModelRoutes(): ModelRoute[];
  /** Re-discovers routes for every registered provider (profile + live discovery when supported/credentialed) and updates the cache. */
  refreshModelRoutes(): Promise<ModelRoute[]>;
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
    routingPreference: config.routingPreference,
  };

  const modeController = new ModeController(config.mode);
  const approvalController = new ApprovalController(process.cwd());
  const uiStream = new UiStream();
  const telemetryExporter = new JsonlObservabilityExporter({
    dir: path.join(config.stateDir, "sessions", rootSessionId, "telemetry"),
  });

  const observability = new DefaultObservabilityProvider({
    resource: { serviceName: "micro-harness-cli", serviceVersion: CLI_VERSION },
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
    compressionTriggerUtilization: config.compactionTriggerUtilization,
    compressionTargetUtilization: config.compactionTargetUtilization,
    turnCompactionTargetRatio: config.turnCompactionTargetRatio,
    nonTurnTokenReserve: config.nonTurnTokenReserve,
  });
  const prompts = new FsPromptSource({ rootDir: config.promptsDir });
  const modelSelector = new EffortModelSelector(runtimeState.effort);
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: credentials,
    selection: () => ({
      providerId: runtimeState.provider,
      model: runtimeState.model,
      maxTokens: config.maxTokens,
    }),
  });
  const sessionService = new SessionService(config.stateDir);
  const sessionStore = sessionService.getStore();

  // Model router: opt-in (only used when a run passes `routing`, i.e. when
  // `runtimeState.routingPreference` is set via `/route` or `--routing-preference`).
  // All providers registered via `builtInProviderPlugins()` (openai, anthropic,
  // ollama) are available simultaneously — the catalog is aggregated across
  // every provider with resolvable credentials, not just the active one, so
  // the router (and per-invocation subagent routing) can pick whichever
  // provider/model best fits a preference, e.g. Claude for intelligence,
  // Ollama for zero cost, or a cheap OpenAI tier for speed.
  const modelRouter = new DefaultModelRouter();
  let routeCatalogCache: ModelRoute[] = routesForProviderProfile(
    runtimeState.provider,
    runtimeState.model,
  );
  const routeCatalog = () => routeCatalogCache;

  async function routesForOneProvider(providerId: string): Promise<ModelRoute[]> {
    const modelOverride = providerId === runtimeState.provider ? runtimeState.model : undefined;
    const profileRoutes = routesForProviderProfile(providerId, modelOverride);
    let auth: ProviderAuth;
    try {
      auth = await credentials.get(providerId).resolve();
    } catch {
      // No credentials configured for this provider (e.g. missing API key
      // env var): keep the active provider usable with its static profile
      // (matches prior single-provider behavior), but exclude other
      // providers entirely since their models genuinely can't be invoked.
      return providerId === runtimeState.provider ? profileRoutes : [];
    }
    let routes: ModelRoute[];
    try {
      const adapter = providers.get(providerId);
      const discovered = await discoverProviderRoutes(providerId, adapter, auth);
      routes = mergeProviderRoutes(profileRoutes, discovered);
    } catch {
      routes = profileRoutes;
    }
    if (providerId === "ollama") {
      routes = await withOllamaContextWindows(routes, auth);
    }
    return routes;
  }

  /**
   * Ollama is the one provider where real per-model context window is
   * knowable automatically (via the local `/api/show` endpoint) rather than
   * from a static pricing table, since locally pulled models vary by
   * quantization/tag. Best-effort and bounded by `detectOllamaContextWindowTokens`'s
   * own timeout; failures leave the route's existing metadata untouched.
   */
  async function withOllamaContextWindows(
    routes: ModelRoute[],
    auth: { baseUrl?: string },
  ): Promise<ModelRoute[]> {
    const baseUrl = auth.baseUrl ?? "http://127.0.0.1:11434/v1";
    return Promise.all(
      routes.map(async (route) => {
        try {
          const detected = await detectOllamaContextWindowTokens({ baseUrl, model: route.model });
          if (!detected || detected <= 0) return route;
          return {
            ...route,
            metadata: {
              ...route.metadata,
              contextWindowTokens: detected,
              contextWindowSource: "discovered" as const,
            },
          };
        } catch {
          return route;
        }
      }),
    );
  }

  async function refreshModelRoutes(): Promise<ModelRoute[]> {
    const perProvider = await Promise.all(
      providers.list().map((a) => routesForOneProvider(a.providerId)),
    );
    routeCatalogCache = perProvider.flat();
    return routeCatalogCache;
  }

  const skills = new SkillRegistry();
  const skillSource = new FsSkillSource({
    rootDir: config.skillsDir ?? path.join(config.stateDir, "skills"),
  });
  for (const skill of await skillSource.loadAll()) {
    skills.register(skill);
  }

  const agent = defineAgent({
    name: "coder",
    prompt: "",
    model,
    modelSelector,
    prompts,
    tools,
    skills,
    context,
    policy,
    observability,
    sessionStore,
    approvalHandler: approvalController.createHandler(() => modeController.getMode()),
  });
  agent.setModelRouting(modelRouter, routeCatalog);

  const subagents = new InProcessSubagentSupervisor(
    {
      async build(request, parent) {
        const childPromptName = await resolveSubagentPromptName(
          request.promptName,
          config.promptsDir,
        );
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
          compressionTriggerUtilization: config.compactionTriggerUtilization,
          compressionTargetUtilization: config.compactionTargetUtilization,
          turnCompactionTargetRatio: config.turnCompactionTargetRatio,
          nonTurnTokenReserve: config.nonTurnTokenReserve,
        });
        const childAgent = defineAgent({
          name: childPromptName,
          prompt: "",
          model,
          modelSelector,
          prompts,
          tools: childTools,
          skills,
          context: childContext,
          policy,
          observability,
          sessionStore,
          approvalHandler: approvalController.createHandler(() => modeController.getMode()),
          kind: "subagent",
        });
        childAgent.setModelRouting(modelRouter, routeCatalog);
        // Per-invocation routing: a spawn request can ask for a specific
        // model/provider or a routing preference (e.g. a cheaper/faster
        // helper agent) without the end user configuring anything.
        const wantsRouting = Boolean(
          request.model || request.providerId || request.routingPreference || request.effort,
        );
        const routing = wantsRouting
          ? {
              preference: request.routingPreference,
              effort: request.effort,
              overrideProviderId: request.model
                ? (request.providerId ?? runtimeState.provider)
                : undefined,
              overrideModel: request.model,
            }
          : undefined;
        return {
          agent: childAgent,
          prompt: request.prompt,
          runOptions: {
            maxIterations: request.maxIterations ?? Math.min(8, config.maxIterations),
            snapshotEvery: config.snapshotEvery,
            profile: profileForProvider(
              request.providerId ?? runtimeState.provider,
              request.model ?? runtimeState.model,
            ),
            modelOverride: request.model ?? runtimeState.model,
            sessionId: childSessionId,
            goal: request.goal ?? request.prompt,
            displayName: request.name ?? request.goal ?? childPromptName,
            parentSessionId: parent.sessionId,
            rootSessionId: rootSessionId,
            parentTrace: request.parentTrace,
            depth: 1,
            routing,
          },
        };
      },
    },
    agent,
  );
  agent.setSubagentSupervisor(subagents);
  agent.setAutoJoinSubagents(true);
  agent.setCompressor(createAgenticCompressor({ spawn: (request) => subagents.run(request) }));

  registerCoreDefaults({
    providerRegistry: providers,
    credentialsRegistry: credentials,
    toolRegistry: tools,
    includeBuiltInProviders: false,
    tools: createCoreDefaultTools({
      workspaceTools: { rootDir: process.cwd() },
      planModeTools: { rootDir: process.cwd() },
      subagents,
      spawnSubagent: { defaultPromptName: "coder" },
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
    exampleToolsPlugin,
  ]);

  async function refreshContextWindowTokens(): Promise<{
    tokens: number;
    provider: string;
    model: string;
    source: "default" | "ollama-api" | "ollama-fallback";
    estimator: string;
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

    let estimator = "heuristic";
    const fallbackCounter = new HeuristicTokenCounter();
    try {
      const adapter = providers.get(provider);
      if (adapter.createTokenCounter) {
        const auth = await credentials.get(provider).resolve();
        const created = await adapter.createTokenCounter(model, auth);
        if (isTokenCounterWithEstimator(created)) {
          estimator = created.estimator ?? `provider:${provider}`;
          agent.setTokenCounter(created.counter, estimator);
        } else {
          estimator = `provider:${provider}`;
          agent.setTokenCounter(created, estimator);
        }
      } else {
        agent.setTokenCounter(fallbackCounter, estimator);
      }
    } catch {
      agent.setTokenCounter(fallbackCounter, estimator);
    }

    contextWindowTokens = tokens;
    agent.setContextWindowTokens(tokens);
    await refreshModelRoutes();
    return { tokens, provider, model, source, estimator };
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
    cliVersion: CLI_VERSION,
    runtimeState,
    refreshContextWindowTokens,
    listModelRoutes: routeCatalog,
    refreshModelRoutes,
    sessionStore,
    subagents,
    runOptions() {
      const mode = modeController.getMode();
      return {
        maxIterations: config.maxIterations,
        unlimitedIterations: config.unlimitedIterations,
        snapshotEvery: config.snapshotEvery,
        profile: profileForProvider(runtimeState.provider, runtimeState.model),
        modelOverride: runtimeState.model,
        sessionId: rootSessionId,
        resume: true,
        capabilityScope: mode === "plan" ? { allowActions: planModeAllowActions() } : undefined,
        // Only engage the router when the user opted in via `/route` or
        // `--routing-preference`; otherwise `modelOverride`/`profile` above
        // drive selection exactly as before, unchanged.
        routing: runtimeState.routingPreference
          ? {
              preference: runtimeState.routingPreference,
              effort: runtimeState.effort,
              overrideProviderId: runtimeState.model ? runtimeState.provider : undefined,
              overrideModel: runtimeState.model,
            }
          : undefined,
      };
    },
  };
}

function isTokenCounterWithEstimator(
  value: TokenCounter | { counter: TokenCounter; estimator?: string },
): value is { counter: TokenCounter; estimator?: string } {
  return "counter" in value;
}
