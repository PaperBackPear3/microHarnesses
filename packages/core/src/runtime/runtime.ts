import { randomUUID } from "node:crypto";
import { ContextManager } from "../context/manager";
import { SessionStore } from "../session/sessionStore";
import { ToolRegistry } from "../tools/registry";
import { ToolTimeoutError } from "../errors";
import {
  AfterLoopHook,
  AgentSpawner,
  BeforeLoopHook,
  EventSink,
  ExecutionEvent,
  HarnessPlugin,
  HarnessState,
  ModelAdapter,
  ModelSelector,
  PromptSource,
  RunOptions,
  RuntimeLimits,
  StepPlan,
  ToolPolicyEngine,
  ToolResult
} from "../types";

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

export class HarnessRuntime {
  private readonly model: ModelAdapter;
  private readonly modelSelector: ModelSelector;
  private readonly prompts: PromptSource;
  private readonly tools: ToolRegistry;
  private readonly context: ContextManager;
  private readonly spawner: AgentSpawner;
  private readonly policy: ToolPolicyEngine;
  private readonly eventSink: EventSink;
  private readonly sessionStore?: SessionStore;
  private readonly limits: RuntimeLimits;
  private readonly beforeHooks: BeforeLoopHook[] = [];
  private readonly afterHooks: AfterLoopHook[] = [];
  private cancelled = false;
  private activeToolController?: AbortController;
  private currentSessionId?: string;

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
    this.limits = deps.limits ?? {
      toolTimeoutMs: 20_000,
      maxToolCallsPerRun: 20
    };
  }

  kill(): void {
    this.cancelled = true;
    this.activeToolController?.abort("runtime killed");
  }

  async registerPlugins(plugins: HarnessPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      await plugin.register({
        registerTool: (tool) => this.tools.register(tool),
        onBeforeLoop: (hook) => this.beforeHooks.push(hook),
        onAfterLoop: (hook) => this.afterHooks.push(hook),
        setCompressor: (compressor) => this.context.setCompressor(compressor)
      });
    }
  }

  async run(agentName: string, userPrompt: string, options: RunOptions): Promise<HarnessState> {
    this.cancelled = false;
    const runId = randomUUID();
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
    this.currentSessionId = sessionId;

    let state: HarnessState = {
      sessionId,
      runId,
      startedAt: new Date().toISOString(),
      turns: []
    };

    if (this.sessionStore && options.resume && sessionId) {
      const restored = await this.sessionStore.loadLatestSnapshot(sessionId);
      if (restored) {
        state = {
          ...restored,
          sessionId,
          runId,
          startedAt: new Date().toISOString()
        };
      }
    }

    await this.context.init();
    this.context.setGoal(goal);
    await this.pushEvent({
      type: "run.started",
      timestamp: new Date().toISOString(),
      runId,
      payload: { agentName, sessionId, resume: Boolean(options.resume), goal }
    });

    const bundle = await this.prompts.load(agentName, userPrompt);
    let totalToolCalls = 0;

    for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
      if (this.cancelled) {
        await this.pushEvent({
          type: "tool.killed",
          timestamp: new Date().toISOString(),
          runId,
          payload: { reason: "runtime killed before next iteration", iteration }
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
          promptHintModel: bundle.metadata.modelHint
        },
        options.profile
      );
      await this.pushEvent({
        type: "model.selected",
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          model: modelSelection.model,
          reason: modelSelection.reason,
          iteration
        }
      });

      const step = await this.model.nextStep({
        agentName,
        userPrompt,
        bundle,
        workingTurns,
        iteration,
        selectedModel: modelSelection.model
      });

      totalToolCalls += step.toolCalls.length;
      if (totalToolCalls > this.limits.maxToolCallsPerRun) {
        await this.pushEvent({
          type: "run.limit_reached",
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            limit: this.limits.maxToolCallsPerRun,
            totalToolCalls
          }
        });
        break;
      }

      const toolResults = await this.executeTools(step, runId, agentName, iteration, bundle.metadata.safetyMode);
      const spawnedAgentResult = step.spawnRequest ? await this.spawner.spawn(step.spawnRequest) : undefined;

      state.turns.push({
        id: randomUUID(),
        iteration,
        userMessage: userPrompt,
        assistantMessage: step.assistantMessage,
        toolCalls: step.toolCalls,
        toolResults,
        spawnedAgentResult
      });

      if (iteration % options.checkpointEvery === 0) {
        await this.context.saveCheckpoint(state);
      }

      if (this.sessionStore && sessionId) {
        const snapshotEvery = options.snapshotEveryIterations ?? options.checkpointEvery;
        if (iteration % snapshotEvery === 0) {
          await this.sessionStore.saveSnapshot(sessionId, runId, state);
        }
      }

      for (const hook of this.afterHooks) {
        await hook(state, iteration);
      }

      if (step.stop) {
        break;
      }
    }

    await this.context.saveCheckpoint(state);
    if (this.sessionStore && sessionId) {
      await this.sessionStore.saveSnapshot(sessionId, runId, state);
    }
    await this.pushEvent({
      type: "run.completed",
      timestamp: new Date().toISOString(),
      runId,
      payload: { turns: state.turns.length, sessionId }
    });

    this.currentSessionId = undefined;
    return state;
  }

  private async executeTools(
    step: StepPlan,
    runId: string,
    agentName: string,
    iteration: number,
    safetyMode?: "strict" | "balanced" | "open"
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of step.toolCalls) {
      if (this.cancelled) {
        await this.pushEvent({
          type: "tool.killed",
          timestamp: new Date().toISOString(),
          runId,
          payload: { tool: call.name, reason: "runtime killed during tool phase", iteration }
        });
        await this.appendSupportHistory({
          runId,
          iteration,
          tool: call.name,
          category: "killed",
          reason: "runtime killed during tool phase"
        });
        results.push({
          ok: false,
          output: {},
          error: "Tool skipped because runtime was killed"
        });
        continue;
      }

      let tool;
      try {
        tool = this.tools.get(call.name);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown tool";
        await this.pushEvent({
          type: "tool.blocked",
          timestamp: new Date().toISOString(),
          runId,
          payload: { tool: call.name, decision: "deny", reason: message, iteration }
        });
        await this.appendSupportHistory({
          runId,
          iteration,
          tool: call.name,
          category: "unknown_tool",
          reason: message
        });
        results.push({ ok: false, output: {}, error: message });
        continue;
      }

      const policy = await this.policy.evaluate(tool, call, {
        runId,
        agentName,
        iteration,
        safetyMode
      });

      if (policy.decision !== "allow") {
        await this.pushEvent({
          type: "tool.blocked",
          timestamp: new Date().toISOString(),
          runId,
          payload: { tool: call.name, decision: policy.decision, reason: policy.reason, iteration }
        });
        await this.appendSupportHistory({
          runId,
          iteration,
          tool: call.name,
          category: "policy",
          reason: policy.reason
        });
        results.push({
          ok: false,
          output: {},
          error: policy.reason
        });
        continue;
      }

      await this.pushEvent({
        type: "tool.allowed",
        timestamp: new Date().toISOString(),
        runId,
        payload: { tool: call.name, iteration }
      });

      try {
        this.activeToolController = new AbortController();
        const output = await withTimeout(
          (signal) => tool.execute(call.input, { signal }),
          this.limits.toolTimeoutMs,
          this.activeToolController
        );
        results.push({ ok: true, output });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown tool error";
        await this.appendSupportHistory({
          runId,
          iteration,
          tool: call.name,
          category: "tool_error",
          reason: message
        });
        results.push({ ok: false, output: {}, error: message });
      } finally {
        this.activeToolController = undefined;
      }
    }
    return results;
  }

  private async pushEvent(event: ExecutionEvent): Promise<void> {
    await this.eventSink.push(event);
    if (this.sessionStore && this.currentSessionId) {
      await this.sessionStore.appendEvent(this.currentSessionId, event);
    }
  }

  private async appendSupportHistory(data: Record<string, unknown>): Promise<void> {
    if (this.sessionStore && this.currentSessionId) {
      await this.sessionStore.appendSupportHistory(this.currentSessionId, data);
    }
  }
}

async function withTimeout<T>(
  runner: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  controller: AbortController
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      controller.abort(`tool timeout ${timeoutMs}ms`);
      reject(new ToolTimeoutError(`Tool exceeded timeout of ${timeoutMs}ms`));
    }, timeoutMs);

    runner(controller.signal)
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}
