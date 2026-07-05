import { randomUUID } from "node:crypto";
import { type ActionCallBudget, ActionExecutionEngine } from "../actions/executionEngine";
import type { ChannelRequest, ChannelResponse } from "../channels/types";
import type { ContextManager } from "../context/manager";
import type { EventSink } from "../events/types";
import type { ModelAdapter, ModelSelector } from "../model/types";
import type { ToolPolicyEngine } from "../policy/types";
import type { PromptSource } from "../prompts/types";
import type { SessionStore } from "../session/sessionStore";
import { ValidationError } from "../shared/errors";
import { skillsAsToolResolver } from "../skills/asTool";
import type { SkillRegistry } from "../skills/registry";
import { deriveToolDescriptors } from "../tools/descriptors";
import type { ToolRegistry } from "../tools/registry";
import type { ToolResult } from "../tools/types";
import { RunEmitter } from "./runEmitter";
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
  eventSink: EventSink;
  sessionStore?: SessionStore;
  limits?: RuntimeLimits;
  approvalHandler?: ApprovalHandler;
  kind?: "main" | "subagent";
  skills?: SkillRegistry;
}

const DEFAULT_LIMITS: RuntimeLimits = {
  toolTimeoutMs: 20_000,
  maxActionCallsPerRun: 20,
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
  private readonly eventSink: EventSink;
  private readonly sessionStore?: SessionStore;
  private readonly defaultLimits: RuntimeLimits;
  private readonly approvalHandler?: ApprovalHandler;
  private readonly skills?: SkillRegistry;
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
    this.eventSink = options.eventSink;
    this.sessionStore = options.sessionStore;
    this.defaultLimits = options.limits ?? DEFAULT_LIMITS;
    this.approvalHandler = options.approvalHandler;
    this.kind = options.kind ?? "main";
    this.skills = options.skills;
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

  async run(userPrompt: string, options: RunOptions): Promise<RunState> {
    validateRunOptions(options);
    const runId = randomUUID();
    const runCtx: RunContext = { runId, cancelled: false, controller: new AbortController() };
    this.activeRuns.add(runCtx);

    const limits: RuntimeLimits = { ...this.defaultLimits, ...options.limits };
    let sessionId = options.sessionId;
    let goal = options.goal ?? userPrompt;

    let emitter: RunEmitter | undefined;
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

      emitter = new RunEmitter(
        { eventSink: this.eventSink, sessionStore: this.sessionStore },
        { runId, sessionId },
      );

      const state = await this.runLoop(runCtx, emitter, userPrompt, options, {
        limits,
        goal,
        sessionId,
        runId,
      });
      await emitter.emit("run.completed", { turns: state.turns.length, sessionId });
      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await emitter?.emit("run.failed", { sessionId, reason: message });
      throw error;
    } finally {
      this.activeRuns.delete(runCtx);
    }
  }

  private async runLoop(
    runCtx: RunContext,
    emitter: RunEmitter,
    userPrompt: string,
    options: RunOptions,
    resolved: { limits: RuntimeLimits; goal: string; sessionId?: string; runId: string },
  ): Promise<RunState> {
    const { limits, goal, sessionId, runId } = resolved;
    const promptName = this.promptName;

    const engine = new ActionExecutionEngine({
      tools: this.tools,
      policy: this.policy,
      limits,
      approvalHandler: this.approvalHandler,
    });
    const skillEngine = this.skills
      ? new ActionExecutionEngine({
          tools: skillsAsToolResolver(this.skills),
          policy: this.policy,
          limits,
          approvalHandler: this.approvalHandler,
          actionLabel: "Skill",
        })
      : undefined;

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

    await this.context.init();
    this.context.setGoal(goal);
    await emitter.emit("run.started", {
      promptName,
      sessionId,
      resume: Boolean(options.resume),
      goal,
    });

    const bundle = await this.prompts.load(promptName, userPrompt);
    const taskType = bundle.metadata.taskTypeHint;
    const budget: ActionCallBudget = { remaining: limits.maxActionCallsPerRun };

    for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
      if (runCtx.cancelled) {
        await emitter.emit("action.killed", {
          reason: "agent killed before next iteration",
          iteration,
        });
        break;
      }

      for (const hook of this.beforeHooks) {
        await hook(state, iteration);
      }

      const working = await this.context.buildWorkingTurns(state.turns);
      const modelSelection = this.modelSelector.select(
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
      await emitter.emit("model.selected", {
        model: modelSelection.model,
        reason: modelSelection.reason,
        iteration,
        taskType: taskType ?? "default",
      });

      let streamedChars = 0;
      let reasoningChars = 0;
      await emitter.emit("model.thinking_started", {
        model: modelSelection.model,
        iteration,
        taskType: taskType ?? "default",
      });
      const step = await this.model.nextStep({
        promptName,
        userPrompt,
        bundle,
        workingTurns: working.recentTurns,
        summary: working.summary,
        iteration,
        selectedModel: modelSelection.model,
        availableTools: deriveToolDescriptors(this.tools.list()),
        availableSkills: this.skills?.list().map((skill) => skill.name) ?? [],
        signal: runCtx.controller.signal,
        onAssistantDelta: async (delta) => {
          if (delta.length === 0) return;
          streamedChars += delta.length;
          await emitter.emit("model.delta", { iteration, delta });
        },
        onReasoningDelta: async (delta) => {
          if (delta.length === 0) return;
          reasoningChars += delta.length;
          await emitter.emit("model.reasoning_delta", { iteration, delta });
        },
      });
      await emitter.emit("model.thinking_completed", {
        model: modelSelection.model,
        iteration,
        taskType: taskType ?? "default",
      });
      if (reasoningChars > 0) {
        await emitter.emit("model.reasoning_stream_completed", {
          iteration,
          chars: reasoningChars,
        });
      }
      if (streamedChars > 0) {
        await emitter.emit("model.stream_completed", { iteration, chars: streamedChars });
      }
      if (step.usage) {
        await emitter.emit("model.completed", {
          model: modelSelection.model,
          iteration,
          usage: step.usage,
        });
      }

      // Honor a kill that arrived while the model was thinking, before side effects.
      if (runCtx.cancelled) {
        await emitter.emit("action.killed", {
          reason: "agent killed during model step",
          iteration,
        });
        break;
      }

      const executionCtx = {
        promptName,
        iteration,
        safetyMode: bundle.metadata.safetyMode,
        emitter,
        isCancelled: () => runCtx.cancelled,
        signal: runCtx.controller.signal,
        budget,
        capabilityScope: options.capabilityScope,
        lineage: {
          parentSessionId: options.parentSessionId,
          parentRunId: options.parentRunId,
          rootSessionId: options.rootSessionId,
          depth: options.depth,
        },
      };

      const toolOutcome = await engine.executeCalls(step.toolCalls, executionCtx);
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
        assistantMessage: step.assistantMessage,
        toolCalls: step.toolCalls,
        toolResults: toolOutcome.results,
        ...(skillCalls.length > 0 ? { skillCalls, skillResults } : {}),
      });

      if (this.sessionStore && sessionId && shouldSnapshot(iteration, options.snapshotEvery)) {
        await this.sessionStore.saveSnapshot(sessionId, runId, state);
      }

      for (const hook of this.afterHooks) {
        await hook(state, iteration);
      }

      if (step.stop || toolOutcome.limitReached || skillLimitReached) {
        break;
      }
    }

    if (this.sessionStore && sessionId) {
      await this.sessionStore.saveSnapshot(sessionId, runId, state);
    }
    return state;
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
    const state = await this.run(request.prompt, request.execution);
    return {
      summary: state.turns[state.turns.length - 1]?.assistantMessage ?? "",
      state,
      runId: state.runId,
      sessionId: state.sessionId,
    };
  }

  async handleChannel(request: ChannelRequest): Promise<ChannelResponse> {
    const result = await this.invoke({
      prompt: request.input,
      execution: {
        ...request.runOptions,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      },
    });
    return {
      state: result.state,
      finalMessage: result.summary,
    };
  }
}

export function validateRunOptions(options: RunOptions): void {
  if (!Number.isInteger(options.maxIterations) || options.maxIterations < 1) {
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
