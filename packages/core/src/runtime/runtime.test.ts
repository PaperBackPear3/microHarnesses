import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessState } from "../context/types";
import type { EventSink, ExecutionEvent } from "../events/types";
import type {
  ModelAdapter,
  ModelProfile,
  ModelSelectionDecision,
  ModelSelectionInput,
  ModelSelector,
  StepInput,
  StepPlan,
} from "../model/types";
import type { ToolPolicyContext, ToolPolicyEngine } from "../policy/types";
import type { PromptBundle, PromptSource } from "../prompts/types";
import { ToolRegistry } from "../tools/registry";
import type { ToolCall, ToolDefinition } from "../tools/types";
import { HarnessRuntime } from "./runtime";
import type { RunOptions } from "./types";

class FakeModel implements ModelAdapter {
  private readonly step: StepPlan;

  constructor(step: StepPlan) {
    this.step = step;
  }

  async nextStep(_input: StepInput): Promise<StepPlan> {
    return this.step;
  }
}

class FakePromptSource implements PromptSource {
  async load(_agentName: string, task: string): Promise<PromptBundle> {
    return {
      system: "system",
      instructions: [],
      task,
      metadata: { name: "default" },
    };
  }
}

class FakeModelSelector implements ModelSelector {
  select(_input: ModelSelectionInput, _profile: ModelProfile): ModelSelectionDecision {
    return { model: "test-model", reason: "profile" };
  }
}

class AllowPolicy implements ToolPolicyEngine {
  async evaluate(
    _tool: ToolDefinition,
    _call: ToolCall,
    _context: ToolPolicyContext,
  ): Promise<{ decision: "allow"; reason: string }> {
    return { decision: "allow", reason: "ok" };
  }
}

class FakeEventSink implements EventSink {
  readonly events: ExecutionEvent[] = [];

  async push(event: ExecutionEvent): Promise<void> {
    this.events.push(event);
  }
}

class FakeContextManager {
  setGoal(_goal: string): void {}
  async init(): Promise<void> {}
  async buildWorkingTurns(state: HarnessState["turns"]): Promise<HarnessState["turns"]> {
    return state;
  }
  async saveCheckpoint(_state: HarnessState): Promise<string> {
    return "cp-test";
  }
}

class FakeSpawner {
  async spawn(_request: { prompt: string }): Promise<string> {
    return "spawned";
  }
}

const options: RunOptions = {
  maxIterations: 1,
  snapshotEvery: 1,
  profile: { defaultModel: "test-model" } as ModelProfile,
};

test("runtime does not crash on unknown tool", async () => {
  const events = new FakeEventSink();
  const runtime = new HarnessRuntime({
    model: new FakeModel({
      assistantMessage: "try tool",
      toolCalls: [{ name: "missing-tool", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    spawner: new FakeSpawner() as never,
    policy: new AllowPolicy(),
    eventSink: events,
  });

  const state = await runtime.run("default", "hello", options);
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /Unknown tool/i);
});

test("runtime emits limit event and exits gracefully when tool call limit is exceeded", async () => {
  const events = new FakeEventSink();
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "echo",
    risk: "low",
    async execute() {
      return { ok: true };
    },
  });

  const runtime = new HarnessRuntime({
    model: new FakeModel({
      assistantMessage: "call tool",
      toolCalls: [{ name: "echo", input: {} }],
      stop: false,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    spawner: new FakeSpawner() as never,
    policy: new AllowPolicy(),
    eventSink: events,
    limits: {
      toolTimeoutMs: 1000,
      maxToolCallsPerRun: 0,
    },
  });

  const state = await runtime.run("default", "hello", options);
  assert.equal(state.turns.length, 0);
  assert.equal(
    events.events.some((event) => event.type === "run.limit_reached"),
    true,
  );
  assert.equal(
    events.events.some((event) => event.type === "run.completed"),
    true,
  );
});
