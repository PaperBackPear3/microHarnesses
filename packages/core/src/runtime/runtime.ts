import { randomUUID } from "node:crypto";
import type { ContextManager } from "../context/manager";
import type { HarnessState } from "../context/types";
import type { EventSink } from "../events/types";
import type { ModelAdapter, ModelSelector } from "../model/types";
import type { ToolPolicyEngine } from "../policy/types";
import type { PromptSource } from "../prompts/types";
import type { SessionStore } from "../session/sessionStore";
import { ValidationError } from "../shared/errors";
import { ToolExecutionEngine } from "../tools/executionEngine";
import type { ToolRegistry } from "../tools/registry";
import { RunEmitter } from "./runEmitter";
import { shouldSnapshot } from "./snapshotCadence";
import type {
  AfterLoopHook,
  AgentSpawner,
  BeforeLoopHook,
  RunOptions,
  RuntimeLimits,
} from "./types";

interface RuntimeDeps {
  model: ModelAdapter;
  modelSelector: ModelSelector;
  prompts: PromptSource;
  tools: ToolRegistry;
  context: ContextManager;
  spawner: AgentSpawner;
  policy: ToolPolicyEngine;
  eventSink: EventSink;
  sessionStore?: SessionStore;
  limits?: RuntimeLimits;
}

const DEFAULT_LIMITS: RuntimeLimits = {
  toolTimeoutMs: 20_000,
  maxToolCallsPerRun: 20,
};

export class HarnessRuntime {
  private readonly model: ModelAdapter;
  private modelSelector: ModelSelector;
  private readonly prompts: PromptSource;
  private readonly tools: ToolRegistry;
  private readonly context: ContextManager;
  private readonly spawner: AgentSpawner;
  private readonly policy: ToolPolicyEngine;
  private readonly eventSink: EventSink;
  private readonly sessionStore?: SessionStore;
  private readonly defaultLimits: RuntimeLimits;
  private readonly beforeHooks: BeforeLoopHook[] = [];
  private readonly afterHooks: AfterLoopHook[] = [];
  private cancelled = false;
  private activeEngine?: ToolExecutionEngine;

  constructor(deps: RuntimeDeps) {
    this.model = deps.model;
    this.modelSelector = deps.modelSelector;
    this.prompts = deps.prompts;
    this.tools = deps.tools;
    this.context = deps.context;
    this.spawner = deps.spawner;
    this.policy = deps.policy;
    this.eventSink = deps.eventSink;
    this.sessionStore = deps.sessionStore;
    this.defaultLimits = deps.limits ?? DEFAULT_LIMITS;
  }

  kill(): void {
    this.cancelled = true;
    this.activeEngine?.abort("runtime killed");
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

  async run(agentName: string, userPrompt: string, options: RunOptions): Promise<HarnessState> {
    validateRunOptions(options);
    this.cancelled = false;
    const runId = randomUUID();
    const limits: RuntimeLimits = { ...this.defaultLimits, ...options.limits };
    let sessionId = options.sessionId;
    let goal = options.goal ?? userPrompt;

    if (this.sessionStore) {
      const manifest = await this.sessionStore.initSession(options.sessionId, goal);
      sessionId = manifest.sessionId;
      goal = manifest.goal || goal;
      if (!manifest.goal && goal) {
        await this.sessionStore.updateGoal(sessionId, goal);
      }
    }

    const emitter = new RunEmitter(
      { eventSink: this.eventSink, sessionStore: this.sessionStore },
      { runId, sessionId },
    );
    const engine = new ToolExecutionEngine({ tools: this.tools, policy: this.policy, limits });
    this.activeEngine = engine;

    let state: HarnessState = {
      sessionId,
      runId,
      startedAt: new Date().toISOString(),
      turns: [],
    };

    if (this.sessionStore && options.resume && sessionId) {
      const restored = await this.sessionStore.loadLatestSnapshot(sessionId);
      if (restored) {
        state = {
          ...restored,
          sessionId,
          runId,
          startedAt: new Date().toISOString(),
        };
      }
    }

    await this.context.init();
    this.context.setGoal(goal);
    await emitter.emit("run.started", {
      agentName,
      sessionId,
      resume: Boolean(options.resume),
      goal,
    });

    const bundle = await this.prompts.load(agentName, userPrompt);
    let totalToolCalls = 0;

    for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
      if (this.cancelled) {
        await emitter.emit("tool.killed", {
          reason: "runtime killed before next iteration",
          iteration,
        });
        break;
      }

      for (const hook of this.beforeHooks) {
        await hook(state, iteration);
      }

      const workingTurns = await this.context.buildWorkingTurns(state.turns);
      const modelSelection = this.modelSelector.select(
        {
          agentName,
          iteration,
          overrideModel: options.modelOverride,
          promptHintModel: bundle.metadata.modelHint,
        },
        options.profile,
      );
      await emitter.emit("model.selected", {
        model: modelSelection.model,
        reason: modelSelection.reason,
        iteration,
      });

      const step = await this.model.nextStep({
        agentName,
        userPrompt,
        bundle,
        workingTurns,
        iteration,
        selectedModel: modelSelection.model,
      });
      if (step.usage) {
        await emitter.emit("model.completed", {
          model: modelSelection.model,
          iteration,
          usage: step.usage,
        });
      }

      totalToolCalls += step.toolCalls.length;
      if (totalToolCalls > limits.maxToolCallsPerRun) {
        await emitter.emit("run.limit_reached", {
          limit: limits.maxToolCallsPerRun,
          totalToolCalls,
        });
        break;
      }

      const toolResults = await engine.executeCalls(step.toolCalls, {
        agentName,
        iteration,
        safetyMode: bundle.metadata.safetyMode,
        emitter,
        isCancelled: () => this.cancelled,
      });
      const spawnedAgentResult = step.spawnRequest
        ? await this.spawner.spawn(step.spawnRequest)
        : undefined;

      state.turns.push({
        id: randomUUID(),
        iteration,
        userMessage: userPrompt,
        assistantMessage: step.assistantMessage,
        toolCalls: step.toolCalls,
        toolResults,
        spawnedAgentResult,
      });

      if (this.sessionStore && sessionId && shouldSnapshot(iteration, options.snapshotEvery)) {
        await this.sessionStore.saveSnapshot(sessionId, runId, state);
      }

      for (const hook of this.afterHooks) {
        await hook(state, iteration);
      }

      if (step.stop) {
        break;
      }
    }

    if (this.sessionStore && sessionId) {
      await this.sessionStore.saveSnapshot(sessionId, runId, state);
    }
    await emitter.emit("run.completed", { turns: state.turns.length, sessionId });

    this.activeEngine = undefined;
    return state;
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
