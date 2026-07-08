import { randomUUID } from "node:crypto";
import { type ActionCallBudget, ActionExecutionEngine } from "../actions/executionEngine";
import type { ContextManager } from "../context/manager";
import type { ModelAdapter, ModelRoute, ModelRouter, ModelSelector } from "../model/types";
import { NoopObservabilityProvider } from "../observability/noop";
import type { ObservabilityProvider, Span, TokenCounter } from "../observability/types";
import type { ToolPolicyEngine } from "../policy/types";
import type { PromptSource } from "../prompts/types";
import type { SessionStore } from "../session/sessionStore";
import { ValidationError } from "../shared/errors";
import { truncate } from "../shared/text";
import { skillsAsToolResolver } from "../skills/asTool";
import type { SkillRegistry } from "../skills/registry";
import type { SubagentSupervisor } from "../subagents/types";
import { deriveToolDescriptors } from "../tools/descriptors";
import { ToolOutputArtifacts } from "../tools/outputArtifacts";
import type { ToolRegistry } from "../tools/registry";
import type { ToolResult } from "../tools/types";
import type { MessageContentPart } from "./content";
import { RunObserver } from "./runObserver";
import { shouldSnapshot } from "./snapshotCadence";
import type { RunState } from "./state";
import type {
  AfterLoopHook,
  AgentHandle,
  AgentInvokeRequest,
  AgentRunResult,
  ApprovalHandler,
  BeforeLoopHook,
  RunOptions,
  RuntimeLimits,
} from "./types";

/**
 * Construction options for an {@link Agent}. The prompt persona (`promptName`)
 * is bound here, not per-run: one Agent instance = one persona.
 */
export interface AgentOptions {
  /** Prompt-pack persona this agent runs (resolved via `PromptSource.load`). */
  promptName: string;
  model: ModelAdapter;
  modelSelector: ModelSelector;
  prompts: PromptSource;
  tools: ToolRegistry;
  context: ContextManager;
  policy: ToolPolicyEngine;
  /** Observability provider (traces + metrics + logs + stream). */
  observability?: ObservabilityProvider;
  sessionStore?: SessionStore;
  limits?: RuntimeLimits;
  approvalHandler?: ApprovalHandler;
  kind?: "main" | "subagent";
  skills?: SkillRegistry;
  subagents?: SubagentSupervisor;
  autoJoinSubagents?: boolean;
  /**
   * Optional model router + route catalog provider. Only used when a run
   * passes `RunOptions.routing`; otherwise `modelSelector`/`profile` behavior
   * is unchanged, keeping routing fully opt-in.
   */
  modelRouter?: ModelRouter;
  routeCatalog?: () => ModelRoute[];
}

const DEFAULT_LIMITS: RuntimeLimits = {
  toolTimeoutMs: 20_000,
  maxActionCallsPerRun: 40,
};

/** Per-`run()` state so concurrent runs on one agent cannot clobber each other. */
interface RunContext {
  runId: string;
  sessionId?: string;
  cancelled: boolean;
  controller: AbortController;
}

/**
 * The top-level executable agent: binds one prompt persona to a model, tools,
 * skills, policy, context, and session store, and runs the governed agent loop.
 * Implements {@link AgentHandle} so it (and its subagents) share a narrow
 * invoke/kill surface.
 */
export class Agent implements AgentHandle {
  readonly id = randomUUID();
  readonly kind: "main" | "subagent";
  readonly promptName: string;
  private readonly model: ModelAdapter;
  private modelSelector: ModelSelector;
  private readonly prompts: PromptSource;
  private readonly tools: ToolRegistry;
  private readonly context: ContextManager;
  private readonly policy: ToolPolicyEngine;
  private readonly observability: ObservabilityProvider;
  private readonly sessionStore?: SessionStore;
  private readonly defaultLimits: RuntimeLimits;
  private readonly approvalHandler?: ApprovalHandler;
  private readonly skills?: SkillRegistry;
  private subagents?: SubagentSupervisor;
  private autoJoinSubagents: boolean;
  private modelRouter?: ModelRouter;
  private routeCatalog?: () => ModelRoute[];
  private readonly beforeHooks: BeforeLoopHook[] = [];
  private readonly afterHooks: AfterLoopHook[] = [];
  private readonly activeRuns = new Set<RunContext>();

  constructor(options: AgentOptions) {
    this.promptName = options.promptName;
    this.model = options.model;
    this.modelSelector = options.modelSelector;
    this.prompts = options.prompts;
    this.tools = options.tools;
    this.context = options.context;
    this.policy = options.policy;
    this.observability = options.observability ?? new NoopObservabilityProvider();
    this.sessionStore = options.sessionStore;
    this.defaultLimits = options.limits ?? DEFAULT_LIMITS;
    this.approvalHandler = options.approvalHandler;
    this.kind = options.kind ?? "main";
    this.skills = options.skills;
    this.subagents = options.subagents;
    this.autoJoinSubagents = options.autoJoinSubagents ?? false;
    this.modelRouter = options.modelRouter;
    this.routeCatalog = options.routeCatalog;
  }

  kill(reason?: string): void {
    for (const run of this.activeRuns) {
      run.cancelled = true;
      run.controller.abort(reason ?? "agent killed");
    }
  }

  addBeforeHook(hook: BeforeLoopHook): void {
    this.beforeHooks.push(hook);
  }

  addAfterHook(hook: AfterLoopHook): void {
    this.afterHooks.push(hook);
  }

  setCompressor(compressor: Parameters<ContextManager["setCompressor"]>[0]): void {
    this.context.setCompressor(compressor);
  }

  setModelSelector(selector: ModelSelector): void {
    this.modelSelector = selector;
  }

  /**
   * Configures optional model routing. Routing only takes effect for runs
   * that explicitly pass `RunOptions.routing`; otherwise `modelSelector`
   * continues to drive model selection unchanged.
   */
  setModelRouting(
    router: ModelRouter | undefined,
    routeCatalog: (() => ModelRoute[]) | undefined,
  ): void {
    this.modelRouter = router;
    this.routeCatalog = routeCatalog;
  }

  setContextWindowTokens(tokens: number): void {
    this.context.setContextWindowTokens(tokens);
  }

  setTokenCounter(counter: TokenCounter, estimator = "custom"): void {
    this.context.setTokenCounter(counter, estimator);
  }

  setSubagentSupervisor(subagents: SubagentSupervisor | undefined): void {
    this.subagents = subagents;
  }

  setAutoJoinSubagents(enabled: boolean): void {
    this.autoJoinSubagents = enabled;
  }

  async compactSession(sessionId: string): Promise<{
    sessionId: string;
    totalTurns: number;
    compressed: boolean;
    forced: boolean;
    overflowTurns: number;
    deltaTurns: number;
    reason?: "no_turns";
  }> {
    if (!this.sessionStore) {
      throw new Error("Manual compaction requires a sessionStore");
    }

    await this.context.init();
    const manifest = await this.sessionStore.getSessionIfExists(sessionId);
    if (!manifest) {
      return {
        sessionId,
        totalTurns: 0,
        compressed: false,
        forced: true,
        overflowTurns: 0,
        deltaTurns: 0,
        reason: "no_turns",
      };
    }
    this.context.setGoal(manifest.goal);
    const snapshot = await this.sessionStore.loadLatestSnapshot(sessionId);
    const turns = snapshot?.turns ?? [];
    const result = await this.context.compactNow(turns);
    const refinedGoal = result.summary?.refinedGoal?.trim();
    if (refinedGoal && (!manifest.goal || manifest.goal.trim().length === 0)) {
      await this.sessionStore.updateGoal(sessionId, refinedGoal);
    }
    return {
      sessionId,
      totalTurns: turns.length,
      compressed: result.compressed,
      forced: result.forced,
      overflowTurns: result.overflowTurns,
      deltaTurns: result.deltaTurns,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }

  async run(userPrompt: string, options: RunOptions): Promise<RunState> {
    return this.runWithInput(userPrompt, options);
  }

  private async runWithInput(
    userPrompt: string,
    options: RunOptions,
    input?: { text?: string; content?: MessageContentPart[] },
  ): Promise<RunState> {
    validateRunOptions(options);
    const runId = randomUUID();
    const runCtx: RunContext = { runId, cancelled: false, controller: new AbortController() };
    this.activeRuns.add(runCtx);

    const limits: RuntimeLimits = { ...this.defaultLimits, ...options.limits };
    let sessionId = options.sessionId;
    let goal = options.goal ?? userPrompt;

    let observer: RunObserver | undefined;
    const startedAt = Date.now();
    try {
      if (this.sessionStore) {
        const manifest = await this.sessionStore.initSession({
          sessionId: options.sessionId,
          goal,
          parentSessionId: options.parentSessionId,
          parentRunId: options.parentRunId,
          rootSessionId: options.rootSessionId,
          depth: options.depth,
          spawnedByTool: options.spawnedByTool,
        });
        sessionId = manifest.sessionId;
        goal = manifest.goal || goal;
        if (!manifest.goal && goal) {
          await this.sessionStore.updateGoal(sessionId, goal);
        }
      }
      runCtx.sessionId = sessionId;

      observer = new RunObserver(
        this.observability,
        {
          runId,
          sessionId,
          rootSessionId: options.rootSessionId,
          depth: options.depth,
          parentTrace: options.parentTrace,
        },
        {
          "prompt.name": this.promptName,
          kind: this.kind,
          ...(options.spawnedByTool ? { spawned_by: options.spawnedByTool } : {}),
        },
      );

      const state = await this.runLoop(runCtx, observer, userPrompt, options, {
        limits,
        goal,
        sessionId,
        runId,
        input,
        outputArtifacts:
          this.sessionStore && sessionId
            ? new ToolOutputArtifacts({ rootDir: this.sessionStore.toolOutputDir(sessionId) })
            : undefined,
      });

      observer.countRun("ok");
      observer.recordRunDuration(Date.now() - startedAt, "ok");
      observer.runSpan.setAttribute("run.turns", state.turns.length);
      observer.runSpan.setStatus({ code: "ok" });
      await observer.stream("run.completed", {
        turns: state.turns.length,
        sessionId,
        kind: this.kind,
        promptName: this.promptName,
        ...(options.displayName ? { displayName: options.displayName } : {}),
        summary: truncate(state.turns[state.turns.length - 1]?.assistantMessage ?? "", 800),
      });
      observer.runSpan.end();
      await this.observability.forceFlush();
      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (observer) {
        observer.countRun("error");
        observer.countError("run_failed");
        observer.recordRunDuration(Date.now() - startedAt, "error");
        observer.log("error", message, { category: "run_failed", sessionId: sessionId ?? "" });
        observer.runSpan.recordException(error, "run_failed");
        await observer.stream("run.failed", {
          sessionId,
          reason: message,
          kind: this.kind,
          promptName: this.promptName,
          ...(options.displayName ? { displayName: options.displayName } : {}),
        });
        observer.runSpan.end();
        await this.observability.forceFlush();
      }
      throw error;
    } finally {
      this.activeRuns.delete(runCtx);
    }
  }

  private async runLoop(
    runCtx: RunContext,
    observer: RunObserver,
    userPrompt: string,
    options: RunOptions,
    resolved: {
      limits: RuntimeLimits;
      goal: string;
      sessionId?: string;
      runId: string;
      input?: { text?: string; content?: MessageContentPart[] };
      outputArtifacts?: ToolOutputArtifacts;
    },
  ): Promise<RunState> {
    const { limits, goal, sessionId, runId, input, outputArtifacts } = resolved;
    const promptName = options.promptName?.trim() || this.promptName;

    let state: RunState = {
      sessionId,
      runId,
      startedAt: new Date().toISOString(),
      turns: [],
    };

    if (this.sessionStore && options.resume && sessionId) {
      const restored = await this.sessionStore.loadLatestSnapshot(sessionId);
      if (restored) {
        state = { ...restored, sessionId, runId, startedAt: new Date().toISOString() };
      }
    }

    const priorTurns = state.turns.length;
    const unlimitedIterations = options.unlimitedIterations ?? false;
    const maxIterations = unlimitedIterations
      ? options.maxIterations
      : adaptiveIterationLimit(options.maxIterations, priorTurns);
    const adaptiveLimits: RuntimeLimits = {
      ...limits,
      maxActionCallsPerRun: adaptiveActionCallLimit(limits.maxActionCallsPerRun, priorTurns),
    };

    const engine = new ActionExecutionEngine({
      tools: this.tools,
      policy: this.policy,
      limits: adaptiveLimits,
      approvalHandler: this.approvalHandler,
    });
    const skillEngine = this.skills
      ? new ActionExecutionEngine({
          tools: skillsAsToolResolver(this.skills),
          policy: this.policy,
          limits: adaptiveLimits,
          approvalHandler: this.approvalHandler,
          actionLabel: "Skill",
        })
      : undefined;

    await this.context.init();
    this.context.setGoal(goal);
    await observer.stream("run.started", {
      promptName,
      sessionId,
      kind: this.kind,
      ...(options.displayName ? { displayName: options.displayName } : {}),
      resume: Boolean(options.resume),
      goal,
      parentSessionId: options.parentSessionId,
      rootSessionId: options.rootSessionId,
      ...(unlimitedIterations ? { unlimitedIterations: true } : { maxIterations }),
      maxActionCallsPerRun: adaptiveLimits.maxActionCallsPerRun,
    });

    const bundle = await this.prompts.load(promptName, userPrompt);
    const taskType = bundle.metadata.taskTypeHint;
    const budget: ActionCallBudget = { remaining: adaptiveLimits.maxActionCallsPerRun };
    let maxIterationLimitReached = false;

    for (let iteration = 1; unlimitedIterations || iteration <= maxIterations; iteration += 1) {
      if (runCtx.cancelled) {
        observer.countError("killed");
        observer.log("warn", "agent killed before next iteration", {
          category: "killed",
          iteration,
        });
        break;
      }

      observer.countIteration({ prompt: promptName });
      const iterationSpan = observer.startIteration(iteration, { "prompt.name": promptName });
      try {
        const stop = await this.runIteration({
          iteration,
          iterationSpan,
          observer,
          runCtx,
          options,
          bundle,
          taskType,
          userPrompt,
          promptName,
          engine,
          skillEngine,
          budget,
          state,
          sessionId,
          runId,
          input,
          outputArtifacts,
        });
        iterationSpan.setStatus({ code: "ok" });
        if (stop) break;
        if (!unlimitedIterations && iteration === maxIterations) {
          maxIterationLimitReached = true;
        }
      } catch (error) {
        iterationSpan.recordException(error);
        throw error;
      } finally {
        iterationSpan.end();
      }
    }

    if (maxIterationLimitReached) {
      const action = "max_iterations";
      observer.countLimitReached(action);
      observer.countError("limit_reached", action);
      observer.log("warn", `Run iteration limit of ${maxIterations} reached`, {
        action,
        category: "limit_reached",
      });
      await observer.stream("limit.reached", {
        action,
        limit: maxIterations,
        iteration: maxIterations,
      });
    }

    if (this.sessionStore && sessionId) {
      await this.sessionStore.saveSnapshot(sessionId, runId, state);
    }
    return state;
  }

  private async runIteration(args: {
    iteration: number;
    iterationSpan: Span;
    observer: RunObserver;
    runCtx: RunContext;
    options: RunOptions;
    bundle: Awaited<ReturnType<PromptSource["load"]>>;
    taskType?: "default" | "reasoning" | "fast";
    userPrompt: string;
    promptName: string;
    engine: ActionExecutionEngine;
    skillEngine?: ActionExecutionEngine;
    budget: ActionCallBudget;
    state: RunState;
    sessionId?: string;
    runId: string;
    outputArtifacts?: ToolOutputArtifacts;
    input?: { text?: string; content?: MessageContentPart[] };
  }): Promise<boolean> {
    const {
      iteration,
      iterationSpan,
      observer,
      runCtx,
      options,
      bundle,
      taskType,
      userPrompt,
      promptName,
      engine,
      skillEngine,
      budget,
      state,
      sessionId,
      runId,
      outputArtifacts,
      input,
    } = args;

    for (const hook of this.beforeHooks) {
      await hook(state, iteration);
    }

    const contextSpan = observer.startContext(iterationSpan);
    const working = await this.context.buildWorkingTurns(state.turns, {
      onCompressionStarted: async ({ overflowTurns, deltaTurns }) => {
        await observer.stream(
          "context.compression_started",
          { iteration, overflowTurns, deltaTurns },
          contextSpan,
        );
      },
      onCompressionCompleted: async ({ overflowTurns, deltaTurns }) => {
        await observer.stream(
          "context.compression_completed",
          { iteration, overflowTurns, deltaTurns },
          contextSpan,
        );
      },
    });
    if (working.stats) {
      observer.recordContext(working.stats);
      contextSpan.setAttributes({
        "context.turns.total": working.stats.totalTurns,
        "context.turns.working": working.stats.workingTurns,
        "context.turns.overflow": working.stats.overflowTurns,
        "context.window.used_tokens": working.stats.usedTokens,
        "context.window.max_tokens": working.stats.maxTokens,
        "context.window.utilization": working.stats.utilization,
        "context.compressed": working.stats.compressed,
      });
      await observer.stream("context.window", { ...working.stats, iteration }, contextSpan);
    }

    contextSpan.end();

    const modelSelection: {
      model: string;
      reason: string;
      providerId?: string;
      maxTokens?: number;
      routeId?: string;
      preference?: string;
    } =
      options.routing && this.modelRouter && this.routeCatalog
        ? (() => {
            const decision = this.modelRouter!.selectRoute(
              { ...options.routing, taskType, agentName: promptName, agentKind: this.kind },
              this.routeCatalog!(),
            );
            return {
              model: decision.route.model,
              reason: decision.reason,
              providerId: decision.route.providerId,
              maxTokens: decision.route.maxTokens,
              routeId: decision.route.id,
              preference: decision.preference,
            };
          })()
        : this.modelSelector.select(
            {
              promptName,
              iteration,
              taskType,
              userPrompt,
              overrideModel: options.modelOverride,
              promptHintModel: bundle.metadata.modelHint,
            },
            options.profile,
          );
    iterationSpan.setAttribute("model.selected", modelSelection.model);
    if (modelSelection.providerId) {
      iterationSpan.setAttribute("model.provider", modelSelection.providerId);
    }
    await observer.stream("model.selected", {
      model: modelSelection.model,
      reason: modelSelection.reason,
      iteration,
      taskType: taskType ?? "default",
      ...(modelSelection.providerId ? { providerId: modelSelection.providerId } : {}),
      ...(modelSelection.routeId ? { routeId: modelSelection.routeId } : {}),
      ...(modelSelection.preference ? { preference: modelSelection.preference } : {}),
    });

    const modelSpan = observer.startModel(iterationSpan, {
      "model.name": modelSelection.model,
      "model.reason": modelSelection.reason,
      "task.type": taskType ?? "default",
      iteration,
    });
    let streamedChars = 0;
    let reasoningChars = 0;
    const modelStartedAt = Date.now();
    await observer.stream(
      "model.thinking_started",
      { model: modelSelection.model, iteration, taskType: taskType ?? "default" },
      modelSpan,
    );

    let step: Awaited<ReturnType<ModelAdapter["nextStep"]>>;
    const inputAssetResolver =
      this.sessionStore && sessionId
        ? (assetId: string) => this.sessionStore!.getInputAsset(sessionId, assetId)
        : undefined;
    try {
      step = await this.model.nextStep({
        promptName,
        userPrompt,
        bundle,
        workingTurns: working.recentTurns,
        summary: working.summary,
        iteration,
        selectedModel: modelSelection.model,
        selectedProviderId: modelSelection.providerId,
        selectedMaxTokens: modelSelection.maxTokens,
        availableTools: deriveToolDescriptors(this.tools.list()),
        availableSkills: this.skills?.list().map((skill) => skill.name) ?? [],
        resolveInputAsset: inputAssetResolver,
        signal: runCtx.controller.signal,
        onAssistantDelta: async (delta) => {
          if (delta.length === 0) return;
          streamedChars += delta.length;
          modelSpan.addEvent("model.output_delta", observer.content({ delta }));
          await observer.stream("model.output_delta", { iteration, delta }, modelSpan);
        },
        onReasoningDelta: async (delta) => {
          if (delta.length === 0) return;
          reasoningChars += delta.length;
          modelSpan.addEvent("model.reasoning_delta", observer.content({ delta }));
          await observer.stream("model.reasoning_delta", { iteration, delta }, modelSpan);
        },
      });
    } catch (error) {
      observer.countModelCall(modelSelection.model, "error");
      observer.countError("model_error");
      observer.recordModelDuration(Date.now() - modelStartedAt, modelSelection.model);
      modelSpan.recordException(error, "model_error");
      modelSpan.end();
      throw error;
    }

    const modelDurationMs = Date.now() - modelStartedAt;
    observer.countModelCall(modelSelection.model, "ok");
    observer.recordModelDuration(modelDurationMs, modelSelection.model);
    observer.countReasoningChars(reasoningChars);
    observer.countStreamChars(streamedChars);
    await observer.stream(
      "model.thinking_completed",
      { model: modelSelection.model, iteration, taskType: taskType ?? "default" },
      modelSpan,
    );
    if (reasoningChars > 0) {
      await observer.stream(
        "model.reasoning_completed",
        { iteration, chars: reasoningChars },
        modelSpan,
      );
    }
    if (streamedChars > 0) {
      await observer.stream(
        "model.output_completed",
        { iteration, chars: streamedChars },
        modelSpan,
      );
    }
    if (step.usage) {
      this.context.recordObservedUsage(working.recentTurns, step.usage.inputTokens);
      observer.countModelTokens(
        modelSelection.model,
        step.usage.inputTokens,
        step.usage.outputTokens,
      );
      modelSpan.setAttributes({
        ...(typeof step.usage.inputTokens === "number"
          ? { "model.tokens.input": step.usage.inputTokens }
          : {}),
        ...(typeof step.usage.outputTokens === "number"
          ? { "model.tokens.output": step.usage.outputTokens }
          : {}),
      });
      await observer.stream(
        "model.usage",
        { model: modelSelection.model, iteration, usage: step.usage },
        modelSpan,
      );
    }
    modelSpan.setAttributes(observer.content({ "model.output": step.assistantMessage }));
    modelSpan.setStatus({ code: "ok" });
    modelSpan.end();

    // Honor a kill that arrived while the model was thinking, before side effects.
    if (runCtx.cancelled) {
      observer.countError("killed");
      observer.log("warn", "agent killed during model step", { category: "killed", iteration });
      return true;
    }

    const executionCtx = {
      runId,
      sessionId,
      promptName,
      iteration,
      safetyMode: bundle.metadata.safetyMode,
      observer,
      parentSpan: iterationSpan,
      isCancelled: () => runCtx.cancelled,
      signal: runCtx.controller.signal,
      budget,
      outputArtifacts,
      capabilityScope: options.capabilityScope,
      lineage: {
        parentSessionId: options.parentSessionId,
        parentRunId: options.parentRunId,
        rootSessionId: options.rootSessionId,
        depth: options.depth,
      },
    };

    const toolOutcome = await engine.executeCalls(step.toolCalls, executionCtx);
    const combinedToolCalls = [...step.toolCalls];
    const combinedToolResults = [...toolOutcome.results];
    const autoJoinResult = await this.autoJoinSubagentsIfEnabled({
      options,
      signal: runCtx.controller.signal,
    });
    if (autoJoinResult) {
      combinedToolCalls.push({
        name: "wait_subagents",
        input: {
          mode: "all",
          auto: true,
          ...(autoJoinResult.ids.length > 0 ? { ids: autoJoinResult.ids } : {}),
        },
      });
      combinedToolResults.push(autoJoinResult.result);
    }
    const skillCalls = step.skillCalls ?? [];
    let skillResults: ToolResult[] = [];
    let skillLimitReached = false;
    if (skillCalls.length > 0) {
      if (skillEngine) {
        const skillOutcome = await skillEngine.executeCalls(skillCalls, executionCtx);
        skillResults = skillOutcome.results;
        skillLimitReached = skillOutcome.limitReached;
      } else {
        skillResults = skillCalls.map((call) => ({
          ok: false,
          output: {},
          error: `Skill "${call.name}" cannot run because no skill registry is configured`,
        }));
      }
    }

    state.turns.push({
      id: randomUUID(),
      iteration,
      // Only the first iteration carries the user prompt; later loop turns are
      // internal continuations and leave it empty (see providerModelAdapter).
      userMessage: iteration === 1 ? userPrompt : "",
      ...(iteration === 1
        ? {
            userContent:
              input?.content ??
              (userPrompt.trim().length > 0 ? [{ type: "text" as const, text: userPrompt }] : []),
          }
        : {}),
      assistantMessage: step.assistantMessage,
      assistantContent:
        step.assistantMessage.trim().length > 0
          ? [{ type: "text", text: step.assistantMessage }]
          : undefined,
      toolCalls: combinedToolCalls,
      toolResults: combinedToolResults,
      ...(skillCalls.length > 0 ? { skillCalls, skillResults } : {}),
    });

    if (this.sessionStore && sessionId && shouldSnapshot(iteration, options.snapshotEvery)) {
      await this.sessionStore.saveSnapshot(sessionId, runId, state);
    }

    for (const hook of this.afterHooks) {
      await hook(state, iteration);
    }

    return Boolean(step.stop || toolOutcome.limitReached || skillLimitReached);
  }

  /** Session id of the most recently started active run, if any. */
  get sessionId(): string | undefined {
    let latest: string | undefined;
    for (const run of this.activeRuns) {
      latest = run.sessionId;
    }
    return latest;
  }

  async invoke(request: AgentInvokeRequest): Promise<AgentRunResult> {
    const state = await this.runWithInput(request.prompt, request.execution, request.input);
    return {
      summary: state.turns[state.turns.length - 1]?.assistantMessage ?? "",
      state,
      runId: state.runId,
      sessionId: state.sessionId,
    };
  }

  private shouldAutoJoinSubagents(options: RunOptions): boolean {
    return options.autoJoinSubagents ?? this.autoJoinSubagents;
  }

  private async autoJoinSubagentsIfEnabled(args: {
    options: RunOptions;
    signal: AbortSignal;
  }): Promise<{ ids: string[]; result: ToolResult } | undefined> {
    if (!this.shouldAutoJoinSubagents(args.options)) return undefined;
    if (!this.subagents) return undefined;
    const tracked = this.subagents.list();
    if (tracked.length === 0) return undefined;

    const runningIds = tracked
      .filter((entry) => entry.status === "running")
      .map((entry) => entry.id);
    const waitOptions =
      runningIds.length > 0
        ? { mode: "all" as const, signal: args.signal, ids: runningIds }
        : { mode: "all" as const, signal: args.signal };
    try {
      const waited = await this.subagents.wait(waitOptions);
      if (waited.completed.length === 0 && waited.running.length === 0) {
        return undefined;
      }
      return {
        ids: runningIds,
        result: {
          ok: true,
          output: {
            completed: waited.completed,
            running: waited.running,
            remaining: waited.running.length,
            auto: true,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "subagent auto-join failed";
      return {
        ids: runningIds,
        result: {
          ok: false,
          output: { auto: true },
          error: message,
        },
      };
    }
  }
}

export function validateRunOptions(options: RunOptions): void {
  if (
    !options.unlimitedIterations &&
    (!Number.isInteger(options.maxIterations) || options.maxIterations < 1)
  ) {
    throw new ValidationError(
      `maxIterations must be a positive integer, got ${String(options.maxIterations)}`,
    );
  }
  if (!Number.isInteger(options.snapshotEvery) || options.snapshotEvery < 1) {
    throw new ValidationError(
      `snapshotEvery must be a positive integer, got ${String(options.snapshotEvery)}`,
    );
  }
  if (options.limits) {
    for (const [key, value] of Object.entries(options.limits)) {
      if (value !== undefined && (!Number.isFinite(value) || value < 1)) {
        throw new ValidationError(`limits.${key} must be a positive number, got ${String(value)}`);
      }
    }
  }
}

function adaptiveIterationLimit(baseLimit: number, priorTurns: number): number {
  if (priorTurns < 24) return baseLimit;
  const growthSteps = Math.floor(priorTurns / 24);
  return Math.min(96, baseLimit + growthSteps * 2);
}

function adaptiveActionCallLimit(baseLimit: number, priorTurns: number): number {
  if (priorTurns < 32) return baseLimit;
  const growthSteps = Math.floor(priorTurns / 32);
  return Math.min(240, baseLimit + growthSteps * 8);
}
