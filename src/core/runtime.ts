import { ContextManager } from "../context/manager";
import { ToolRegistry } from "../tools/registry";
import {
  AfterLoopHook,
  AgentSpawner,
  BeforeLoopHook,
  HarnessPlugin,
  HarnessState,
  ModelAdapter,
  RunOptions,
  StepPlan,
  ToolResult
} from "./types";

interface RuntimeDeps {
  model: ModelAdapter;
  tools: ToolRegistry;
  context: ContextManager;
  spawner: AgentSpawner;
}

export class HarnessRuntime {
  private readonly model: ModelAdapter;
  private readonly tools: ToolRegistry;
  private readonly context: ContextManager;
  private readonly spawner: AgentSpawner;
  private readonly beforeHooks: BeforeLoopHook[] = [];
  private readonly afterHooks: AfterLoopHook[] = [];

  constructor(deps: RuntimeDeps) {
    this.model = deps.model;
    this.tools = deps.tools;
    this.context = deps.context;
    this.spawner = deps.spawner;
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

  async run(userPrompt: string, options: RunOptions): Promise<HarnessState> {
    const state: HarnessState = {
      runId: `run-${Date.now()}`,
      startedAt: new Date().toISOString(),
      turns: []
    };

    await this.context.init();

    for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
      for (const hook of this.beforeHooks) {
        await hook(state, iteration);
      }

      const workingTurns = await this.context.buildWorkingTurns(state.turns);
      const step = await this.model.nextStep({
        userPrompt,
        workingTurns,
        iteration
      });

      const toolResults = await this.executeTools(step);
      const spawnedAgentResult = await this.executeSpawn(step);

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
    return state;
  }

  private async executeTools(step: StepPlan): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of step.toolCalls) {
      try {
        const tool = this.tools.get(call.name);
        const output = await tool.execute(call.input);
        results.push({ ok: true, output });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "unknown tool error";
        results.push({ ok: false, output: {}, error: message });
      }
    }
    return results;
  }

  private async executeSpawn(step: StepPlan): Promise<string | undefined> {
    if (!step.spawnRequest) {
      return undefined;
    }
    return this.spawner.spawn(step.spawnRequest);
  }
}
