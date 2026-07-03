import { ContextManager } from "../context/manager";
import { PolicyDeniedError, ToolTimeoutError } from "../errors";
import {
  AfterLoopHook,
  AgentSpawner,
  BeforeLoopHook,
  EventSink,
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
import { ToolRegistry } from "../tools/registry";

interface RuntimeDeps {
  model: ModelAdapter;
  modelSelector: ModelSelector;
  prompts: PromptSource;
  tools: ToolRegistry;
  context: ContextManager;
  spawner: AgentSpawner;
  policy: ToolPolicyEngine;
  eventSink: EventSink;
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
  private readonly limits: RuntimeLimits;
  private readonly beforeHooks: BeforeLoopHook[] = [];
  private readonly afterHooks: AfterLoopHook[] = [];
  private cancelled = false;

  constructor(deps: RuntimeDeps) {
    this.model = deps.model;
    this.modelSelector = deps.modelSelector;
    this.prompts = deps.prompts;
    this.tools = deps.tools;
    this.context = deps.context;
    this.spawner = deps.spawner;
    this.policy = deps.policy;
    this.eventSink = deps.eventSink;
    this.limits = deps.limits ?? {
      toolTimeoutMs: 20_000,
      maxToolCallsPerRun: 20
    };
  }

  kill(): void {
    this.cancelled = true;
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
    const state: HarnessState = {
      runId: `run-${Date.now()}`,
      startedAt: new Date().toISOString(),
      turns: []
    };
    await this.eventSink.push({
      type: "run.started",
      timestamp: new Date().toISOString(),
      runId: state.runId,
      payload: { agentName }
    });

    await this.context.init();
    const bundle = await this.prompts.load(agentName, userPrompt);
    let totalToolCalls = 0;

    for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
      if (this.cancelled) {
        await this.eventSink.push({
          type: "tool.killed",
          timestamp: new Date().toISOString(),
          runId: state.runId,
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
          promptHintModel: bundle.metadata.modelHint
        },
        options.profile
      );
      await this.eventSink.push({
        type: "model.selected",
        timestamp: new Date().toISOString(),
        runId: state.runId,
        payload: {
          model: modelSelection.model,
          reason: modelSelection.reason
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
        throw new PolicyDeniedError("Max tool calls per run exceeded");
      }

      const toolResults = await this.executeTools(step, state.runId, agentName, iteration);
      const spawnedAgentResult = step.spawnRequest ? await this.spawner.spawn(step.spawnRequest) : undefined;

      state.turns.push({
        id: `turn-${Date.now()}-${iteration}`,
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

      for (const hook of this.afterHooks) {
        await hook(state, iteration);
      }

      if (step.stop) {
        break;
      }
    }

    await this.context.saveCheckpoint(state);
    await this.eventSink.push({
      type: "run.completed",
      timestamp: new Date().toISOString(),
      runId: state.runId,
      payload: { turns: state.turns.length }
    });
    return state;
  }

  private async executeTools(step: StepPlan, runId: string, agentName: string, iteration: number): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of step.toolCalls) {
      const tool = this.tools.get(call.name);
      const policy = await this.policy.evaluate(tool, call, {
        runId,
        agentName,
        iteration
      });

      if (policy.decision !== "allow") {
        await this.eventSink.push({
          type: "tool.blocked",
          timestamp: new Date().toISOString(),
          runId,
          payload: { tool: call.name, decision: policy.decision, reason: policy.reason, iteration }
        });
        results.push({
          ok: false,
          output: {},
          error: policy.reason
        });
        continue;
      }

      await this.eventSink.push({
        type: "tool.allowed",
        timestamp: new Date().toISOString(),
        runId,
        payload: { tool: call.name, iteration }
      });

      try {
        const output = await withTimeout(tool.execute(call.input), this.limits.toolTimeoutMs);
        results.push({ ok: true, output });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown tool error";
        results.push({ ok: false, output: {}, error: message });
      }
    }
    return results;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new ToolTimeoutError(`Tool exceeded timeout of ${timeoutMs}ms`));
    }, timeoutMs);

    promise
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
