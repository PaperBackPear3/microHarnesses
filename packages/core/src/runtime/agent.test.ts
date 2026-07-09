import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ContextManager } from "../context/manager";
import { DefaultModelRouter } from "../model/modelRouter";
import type {
  ModelAdapter,
  ModelProfile,
  ModelRoute,
  ModelSelectionDecision,
  ModelSelectionInput,
  ModelSelector,
  StepInput,
  StepPlan,
} from "../model/types";
import { InMemoryObservabilityExporter } from "../observability/inMemoryExporter";
import { createObservability } from "../observability/provider";
import type { ObservabilityProvider, StreamEvent, StreamSink } from "../observability/types";
import type { ToolPolicyContext, ToolPolicyEngine, ToolPolicyEvaluation } from "../policy/types";
import type { PromptBundle, PromptSource } from "../prompts/types";
import { SessionStore } from "../session/sessionStore";
import { SkillRegistry } from "../skills/registry";
import type {
  SubagentResult,
  SubagentRunOptions,
  SubagentSnapshot,
  SubagentSpawnResult,
  SubagentWaitOptions,
  SubagentWaitResult,
} from "../subagents/types";
import { ToolRegistry } from "../tools/registry";
import type { ToolCall, ToolDefinition } from "../tools/types";
import { Agent } from "./agent";
import type { RunState } from "./state";
import type { RunOptions } from "./types";

class CapturingStreamSink implements StreamSink {
  readonly events: StreamEvent[] = [];
  push(event: StreamEvent): void {
    this.events.push(event);
  }
  types(): string[] {
    return this.events.map((e) => e.type);
  }
  ofType(type: string): StreamEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

interface Obs {
  provider: ObservabilityProvider;
  stream: CapturingStreamSink;
  memory: InMemoryObservabilityExporter;
}

function makeObs(): Obs {
  const stream = new CapturingStreamSink();
  const memory = new InMemoryObservabilityExporter();
  const provider = createObservability({
    stream,
    traceExporters: [memory],
    metricExporters: [memory],
    logExporters: [memory],
    logLevel: "trace",
  });
  return { provider, stream, memory };
}

class FakeModel implements ModelAdapter {
  private readonly step: StepPlan;
  constructor(step: StepPlan) {
    this.step = step;
  }
  async nextStep(_input: StepInput): Promise<StepPlan> {
    return this.step;
  }
}

class CapturingModel implements ModelAdapter {
  seen?: StepInput;
  private readonly step: StepPlan;
  constructor(step: StepPlan) {
    this.step = step;
  }
  async nextStep(input: StepInput): Promise<StepPlan> {
    this.seen = input;
    return this.step;
  }
}

class SequenceModel implements ModelAdapter {
  private index = 0;
  constructor(private readonly steps: StepPlan[]) {}
  async nextStep(_input: StepInput): Promise<StepPlan> {
    const step = this.steps[Math.min(this.index, this.steps.length - 1)];
    this.index += 1;
    return step;
  }
}

class FakeStreamingModel implements ModelAdapter {
  async nextStep(input: StepInput): Promise<StepPlan> {
    await input.onReasoningDelta?.("thinking...");
    await input.onAssistantDelta?.("hello ");
    await input.onAssistantDelta?.("world");
    return { assistantMessage: "hello world", toolCalls: [], stop: true };
  }
}

class FakePromptSource implements PromptSource {
  async load(_promptName: string, task: string): Promise<PromptBundle> {
    return { system: "system", instructions: [], task, metadata: { name: "default" } };
  }
}

class ReasoningPromptSource implements PromptSource {
  async load(_promptName: string, task: string): Promise<PromptBundle> {
    return {
      system: "system",
      instructions: [],
      task,
      metadata: { name: "default", taskTypeHint: "reasoning" },
    };
  }
}

class FakeModelSelector implements ModelSelector {
  select(_input: ModelSelectionInput, _profile: ModelProfile): ModelSelectionDecision {
    return { model: "test-model", reason: "profile" };
  }
}

class FakeSubagents {
  private tracked: SubagentSnapshot[] = [];
  waitCalls = 0;

  async run(_options: SubagentRunOptions): Promise<SubagentResult> {
    throw new Error("not used");
  }

  async spawn(_options: SubagentRunOptions): Promise<SubagentSpawnResult> {
    const snapshot: SubagentSnapshot = {
      id: "sub-1",
      launchIndex: 1,
      prompt: "calc",
      status: "running",
      startedAt: new Date().toISOString(),
    };
    this.tracked = [snapshot];
    return { id: snapshot.id, launchIndex: snapshot.launchIndex, status: "running" };
  }

  async wait(_options?: SubagentWaitOptions): Promise<SubagentWaitResult> {
    this.waitCalls += 1;
    const running = this.tracked.filter((entry) => entry.status === "running");
    if (running.length === 0) return { completed: [], running: [] };
    const completed: SubagentSnapshot = {
      ...running[0],
      status: "completed",
      completedAt: new Date().toISOString(),
      summary: "4",
    };
    this.tracked = [completed];
    return { completed: [completed], running: [] };
  }

  list(): SubagentSnapshot[] {
    return this.tracked;
  }
}

class CapturingModelSelector implements ModelSelector {
  seen?: ModelSelectionInput;
  select(input: ModelSelectionInput, _profile: ModelProfile): ModelSelectionDecision {
    this.seen = input;
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

class FakeContextManager {
  setGoal(_goal: string): void {}
  async init(): Promise<void> {}
  setTokenCounter(): void {}
  recordObservedUsage(): void {}
  async buildWorkingTurns(state: RunState["turns"]): Promise<{ recentTurns: RunState["turns"] }> {
    return { recentTurns: state };
  }
}

class CompressingContextManager extends FakeContextManager {
  async buildWorkingTurns(
    state: RunState["turns"],
    hooks?: {
      onCompressionStarted?(details: {
        overflowTurns: number;
        deltaTurns: number;
      }): Promise<void> | void;
      onCompressionCompleted?(details: {
        overflowTurns: number;
        deltaTurns: number;
      }): Promise<void> | void;
    },
  ): Promise<{ recentTurns: RunState["turns"] }> {
    await hooks?.onCompressionStarted?.({ overflowTurns: 3, deltaTurns: 2 });
    await hooks?.onCompressionCompleted?.({ overflowTurns: 3, deltaTurns: 2 });
    return { recentTurns: state };
  }
}

const options: RunOptions = {
  maxIterations: 1,
  snapshotEvery: 1,
  profile: { defaultModel: "test-model" } as ModelProfile,
};

test("runtime does not crash on unknown tool", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "try tool",
      toolCalls: [{ name: "missing-tool", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("hello", options);
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /Unknown tool/i);
});

test("runtime normalizes simple function-style tool names", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  tools.register({
    name: "time",
    description: "time",
    risk: "low",
    async execute() {
      return { now: "2026-01-01T00:00:00.000Z" };
    },
  });

  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "call time",
      toolCalls: [{ name: "time()", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("hello", options);
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0]?.toolCalls[0]?.name, "time()");
  assert.equal(state.turns[0]?.toolResults[0]?.ok, true);
  assert.deepEqual(state.turns[0]?.toolResults[0]?.output, { now: "2026-01-01T00:00:00.000Z" });
});

test("runtime forwards runtimeInstructions without mutating persisted userMessage", async () => {
  const obs = makeObs();
  const model = new CapturingModel({
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const runtime = new Agent({
    promptName: "default",
    model,
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("create it", {
    ...options,
    runtimeInstructions: ["Autopilot contract:\n- Continue autonomously."],
  });

  assert.deepEqual(model.seen?.runtimeInstructions, [
    "Autopilot contract:\n- Continue autonomously.",
  ]);
  assert.equal(state.turns[0]?.userMessage, "create it");
});

test("runtime auto-joins subagents when enabled", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  const subagents = new FakeSubagents();
  tools.register({
    name: "spawn_subagent",
    description: "spawn",
    risk: "high",
    async execute() {
      const spawned = await subagents.spawn({ prompt: "calc 2+2" });
      return { subagentId: spawned.id, status: spawned.status, launchIndex: spawned.launchIndex };
    },
  });

  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "",
      toolCalls: [{ name: "spawn_subagent", input: { prompt: "calc 2+2" } }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    subagents,
    autoJoinSubagents: true,
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("hello", options);
  assert.equal(subagents.waitCalls, 1);
  assert.equal(state.turns[0]?.toolCalls.length, 2);
  assert.equal(state.turns[0]?.toolCalls[1]?.name, "wait_subagents");
  assert.equal(state.turns[0]?.toolResults[1]?.ok, true);
  assert.equal(
    Array.isArray((state.turns[0]?.toolResults[1]?.output as { completed?: unknown[] }).completed),
    true,
  );
});

test("run option can disable runtime auto-join subagents", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  const subagents = new FakeSubagents();
  tools.register({
    name: "spawn_subagent",
    description: "spawn",
    risk: "high",
    async execute() {
      const spawned = await subagents.spawn({ prompt: "calc 2+2" });
      return { subagentId: spawned.id, status: spawned.status, launchIndex: spawned.launchIndex };
    },
  });

  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "",
      toolCalls: [{ name: "spawn_subagent", input: { prompt: "calc 2+2" } }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    subagents,
    autoJoinSubagents: true,
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("hello", { ...options, autoJoinSubagents: false });
  assert.equal(subagents.waitCalls, 0);
  assert.equal(state.turns[0]?.toolCalls.length, 1);
});

test("runtime streams limit event and exits gracefully when tool call limit is exceeded", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "echo",
    risk: "low",
    async execute() {
      return { ok: true };
    },
  });

  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "call tool",
      toolCalls: [{ name: "echo", input: {} }],
      stop: false,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
    limits: { toolTimeoutMs: 1000, maxActionCallsPerRun: 0 },
  });

  const state = await runtime.run("hello", options);
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /limit/i);
  assert.equal(obs.stream.ofType("limit.reached").length > 0, true);
  assert.equal(obs.stream.ofType("run.completed").length > 0, true);
  assert.equal(
    obs.memory.getMetrics().some((m) => m.name === "runtime.limit_reached"),
    true,
  );
});

test("runtime can run without an iteration cap when unlimitedIterations is enabled", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new SequenceModel([
      { assistantMessage: "step 1", toolCalls: [], stop: false },
      { assistantMessage: "step 2", toolCalls: [], stop: false },
      { assistantMessage: "done", toolCalls: [], stop: true },
    ]),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("hello", {
    ...options,
    maxIterations: 1,
    unlimitedIterations: true,
  });

  assert.equal(state.turns.length, 3);
  assert.equal(obs.stream.ofType("limit.reached").length, 0);
});

test("tool executionTimeoutMs='none' bypasses default per-tool timeout", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  tools.register({
    name: "wait_forever",
    description: "long wait",
    risk: "low",
    executionTimeoutMs: "none",
    async execute() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { done: true };
    },
  });

  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "wait",
      toolCalls: [{ name: "wait_forever", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
    limits: { toolTimeoutMs: 5, maxActionCallsPerRun: 10 },
  });

  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, true);
});

test("tool executionTimeoutMs='none' still aborts when run is killed", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  let started = false;
  let resolveStarted: (() => void) | undefined;
  const startedPromise = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  tools.register({
    name: "wait_for_abort",
    description: "wait for cancellation",
    risk: "low",
    executionTimeoutMs: "none",
    async execute(_input, context) {
      started = true;
      resolveStarted?.();
      await new Promise<void>((_resolve, reject) => {
        context?.signal.addEventListener("abort", () => reject(new Error("cancelled by signal")), {
          once: true,
        });
      });
      return { unreachable: true };
    },
  });

  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "wait",
      toolCalls: [{ name: "wait_for_abort", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
    limits: { toolTimeoutMs: 5, maxActionCallsPerRun: 10 },
  });

  const runPromise = runtime.run("hello", options);
  await startedPromise;
  runtime.kill("test kill");
  const state = await runPromise;

  assert.equal(started, true);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /run was cancelled/i);
});

test("runtime emits limit event when max iterations are exhausted", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "keep going",
      toolCalls: [],
      stop: false,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("hello", { ...options, maxIterations: 1 });
  assert.equal(state.turns.length, 1);
  const reached = obs.stream.ofType("limit.reached");
  assert.equal(reached.length > 0, true);
  assert.equal(reached[0]?.payload.action, "max_iterations");
});

test("runtime streams model deltas and completion events", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeStreamingModel(),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.assistantMessage, "hello world");
  assert.equal(obs.stream.ofType("model.output_delta").length, 2);
  assert.equal(obs.stream.ofType("model.reasoning_delta").length, 1);
  assert.equal(obs.stream.ofType("model.thinking_started").length > 0, true);
  assert.equal(obs.stream.ofType("model.thinking_completed").length > 0, true);
  assert.equal(obs.stream.ofType("model.reasoning_completed").length > 0, true);
  assert.equal(obs.stream.ofType("model.output_completed").length > 0, true);
});

test("runtime streams context compression lifecycle events", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({ assistantMessage: "ok", toolCalls: [], stop: true }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new CompressingContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  await runtime.run("hello", options);
  assert.equal(obs.stream.ofType("context.compression_started").length, 1);
  assert.equal(obs.stream.ofType("context.compression_completed").length, 1);
});

test("runtime records a span tree with run, iteration, model, and context spans", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeStreamingModel(),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  await runtime.run("hello", options);
  const spans = obs.memory.getSpans();
  const kinds = spans.map((s) => s.kind);
  assert.equal(kinds.includes("run"), true);
  assert.equal(kinds.includes("iteration"), true);
  assert.equal(kinds.includes("model"), true);
  // All spans share the run's trace id.
  const runSpan = spans.find((s) => s.kind === "run");
  assert.ok(runSpan);
  for (const span of spans) {
    assert.equal(span.context.traceId, runSpan?.context.traceId);
  }
});

test("runtime passes taskType hint into model selector and stream", async () => {
  const obs = makeObs();
  const selector = new CapturingModelSelector();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({ assistantMessage: "ok", toolCalls: [], stop: true }),
    modelSelector: selector,
    prompts: new ReasoningPromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  await runtime.run("hello", options);
  assert.equal(selector.seen?.taskType, "reasoning");
  const selected = obs.stream.ofType("model.selected")[0];
  assert.equal(selected?.payload.taskType, "reasoning");
});

test("without routing configured, modelSelector path is unchanged (opt-in routing)", async () => {
  const obs = makeObs();
  const selector = new CapturingModelSelector();
  const model = new CapturingModel({ assistantMessage: "ok", toolCalls: [], stop: true });
  const runtime = new Agent({
    promptName: "default",
    model,
    modelSelector: selector,
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  // No modelRouter/routeCatalog configured, and no options.routing passed.
  await runtime.run("hello", options);
  assert.equal(selector.seen !== undefined, true);
  assert.equal(model.seen?.selectedModel, "test-model");
  assert.equal(model.seen?.selectedProviderId, undefined);
  assert.equal(model.seen?.selectedMaxTokens, undefined);
});

test("routing is not used when options.routing is omitted, even if a router is configured", async () => {
  const obs = makeObs();
  const selector = new CapturingModelSelector();
  const model = new CapturingModel({ assistantMessage: "ok", toolCalls: [], stop: true });
  const routes: ModelRoute[] = [{ id: "openai:gpt-4.1", providerId: "openai", model: "gpt-4.1" }];
  const runtime = new Agent({
    promptName: "default",
    model,
    modelSelector: selector,
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
    modelRouter: new DefaultModelRouter(),
    routeCatalog: () => routes,
  });

  await runtime.run("hello", options);
  // Configuring a router doesn't change behavior unless a run opts in via `options.routing`.
  assert.equal(model.seen?.selectedModel, "test-model");
  assert.equal(model.seen?.selectedProviderId, undefined);
});

test("router selects a route and passes provider/maxTokens through to the model adapter", async () => {
  const obs = makeObs();
  const model = new CapturingModel({ assistantMessage: "ok", toolCalls: [], stop: true });
  const routes: ModelRoute[] = [
    {
      id: "openai:gpt-4.1-mini",
      providerId: "openai",
      model: "gpt-4.1-mini",
      maxTokens: 2048,
      metadata: { cost: 1, speed: 3, intelligence: 1 },
    },
    {
      id: "openai:o4-mini",
      providerId: "openai",
      model: "o4-mini",
      maxTokens: 8192,
      metadata: { cost: 3, speed: 1, intelligence: 3 },
    },
  ];
  const runtime = new Agent({
    promptName: "default",
    model,
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
    modelRouter: new DefaultModelRouter(),
    routeCatalog: () => routes,
  });

  const routedOptions: RunOptions = { ...options, routing: { preference: "intelligence" } };
  await runtime.run("hello", routedOptions);

  assert.equal(model.seen?.selectedModel, "o4-mini");
  assert.equal(model.seen?.selectedProviderId, "openai");
  assert.equal(model.seen?.selectedMaxTokens, 8192);

  const selected = obs.stream.ofType("model.selected")[0];
  assert.equal(selected?.payload.model, "o4-mini");
  assert.equal(selected?.payload.providerId, "openai");
  assert.equal(selected?.payload.routeId, "openai:o4-mini");
  assert.equal(selected?.payload.preference, "intelligence");
  assert.equal(selected?.payload.reason, "preference");
});

test("router honors an explicit override even over a routing preference", async () => {
  const obs = makeObs();
  const model = new CapturingModel({ assistantMessage: "ok", toolCalls: [], stop: true });
  const routes: ModelRoute[] = [
    { id: "openai:gpt-4.1-mini", providerId: "openai", model: "gpt-4.1-mini" },
    { id: "openai:o4-mini", providerId: "openai", model: "o4-mini" },
  ];
  const runtime = new Agent({
    promptName: "default",
    model,
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
    modelRouter: new DefaultModelRouter(),
    routeCatalog: () => routes,
  });

  const routedOptions: RunOptions = {
    ...options,
    routing: {
      preference: "cost",
      overrideProviderId: "openai",
      overrideModel: "gpt-4.1-mini",
    },
  };
  await runtime.run("hello", routedOptions);
  assert.equal(model.seen?.selectedModel, "gpt-4.1-mini");
  const selected = obs.stream.ofType("model.selected")[0];
  assert.equal(selected?.payload.reason, "override");
});

class ApprovalPolicy implements ToolPolicyEngine {
  async evaluate() {
    return { decision: "require_approval" as const, reason: "test approval" };
  }
}

test("approval handler that returns true allows the tool call", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  tools.register({
    name: "risky",
    description: "",
    risk: "high",
    async execute() {
      return { ran: true };
    },
  });
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "call risky",
      toolCalls: [{ name: "risky", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new ApprovalPolicy(),
    observability: obs.provider,
    approvalHandler: async () => true,
  });
  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, true);
  const resolved = obs.stream.ofType("tool.approval_resolved")[0];
  assert.equal(resolved?.payload.approved, true);
});

test("approval handler that returns false blocks the tool call", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  tools.register({
    name: "risky",
    description: "",
    risk: "high",
    async execute() {
      return { ran: true };
    },
  });
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "call risky",
      toolCalls: [{ name: "risky", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new ApprovalPolicy(),
    observability: obs.provider,
    approvalHandler: async () => false,
  });
  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /Approval denied/);
});

test("missing approval handler blocks require_approval", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  tools.register({
    name: "risky",
    description: "",
    risk: "high",
    async execute() {
      return { ran: true };
    },
  });
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "call risky",
      toolCalls: [{ name: "risky", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new ApprovalPolicy(),
    observability: obs.provider,
  });
  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /no handler/);
});

test("RunOptions.limits overrides runtime default limits per run", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "",
    risk: "low",
    async execute() {
      return {};
    },
  });
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "",
      toolCalls: [{ name: "echo", input: {} }],
      stop: false,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
    limits: { toolTimeoutMs: 5000, maxActionCallsPerRun: 100 },
  });
  const state = await runtime.run("hello", {
    ...options,
    maxIterations: 3,
    limits: { maxActionCallsPerRun: 1 },
  });
  assert.equal(state.turns.length, 2);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, true);
  assert.equal(state.turns[1]?.toolResults[0]?.ok, false);
  assert.match(state.turns[1]?.toolResults[0]?.error ?? "", /limit/i);
  assert.equal(obs.stream.ofType("limit.reached").length > 0, true);
});

test("invoke adapter returns AgentRunResult with summary", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({ assistantMessage: "done", toolCalls: [], stop: true }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const result = await runtime.invoke({ prompt: "hello", execution: options });
  assert.equal(result.summary, "done");
  assert.equal(result.runId.length > 0, true);
});

test("capabilityScope denyActions blocks tool execution", async () => {
  const obs = makeObs();
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "echo",
    risk: "low",
    async execute() {
      return { ok: true };
    },
  });
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "call echo",
      toolCalls: [{ name: "echo", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools,
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });

  const state = await runtime.run("hello", {
    ...options,
    capabilityScope: { denyActions: ["echo"] },
  });
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /out of scope/i);
});

test("runtime executes skillCalls when skill engine is configured", async () => {
  const obs = makeObs();
  const skills = new SkillRegistry();
  skills.register({
    name: "summarize",
    description: "test skill",
    async execute() {
      return { summary: "ok" };
    },
  });
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "call skill",
      toolCalls: [],
      skillCalls: [{ name: "summarize", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
    skills,
  });
  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.skillResults?.[0]?.ok, true);
});

class DenyByNamePolicy implements ToolPolicyEngine {
  constructor(private readonly blocked: string) {}
  async evaluate(_tool: ToolDefinition, call: ToolCall): Promise<ToolPolicyEvaluation> {
    if (call.name === this.blocked) {
      return { decision: "deny", reason: `blocked ${call.name}` };
    }
    return { decision: "allow", reason: "ok" };
  }
}

test("skills are governed by the policy engine (a denied skill does not run)", async () => {
  const obs = makeObs();
  const skills = new SkillRegistry();
  let ran = false;
  skills.register({
    name: "danger_skill",
    description: "test skill",
    async execute() {
      ran = true;
      return { done: true };
    },
  });
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "call skill",
      toolCalls: [],
      skillCalls: [{ name: "danger_skill", input: {} }],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new DenyByNamePolicy("danger_skill"),
    observability: obs.provider,
    skills,
  });
  const state = await runtime.run("hello", options);
  assert.equal(ran, false);
  assert.equal(state.turns[0]?.skillResults?.[0]?.ok, false);
  assert.equal(obs.stream.ofType("tool.blocked").length > 0, true);
});

class ThrowingModel implements ModelAdapter {
  async nextStep(_input: StepInput): Promise<StepPlan> {
    throw new Error("model exploded");
  }
}

test("compactSession returns no_turns when the session does not exist", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-agent-compact-missing-"));
  try {
    const runtime = new Agent({
      promptName: "default",
      model: new FakeModel({ assistantMessage: "ok", toolCalls: [], stop: true }),
      modelSelector: new FakeModelSelector(),
      prompts: new FakePromptSource(),
      tools: new ToolRegistry(),
      context: new ContextManager({
        stateDir: path.join(stateDir, "context"),
        maxWorkingTurns: 8,
      }),
      policy: new AllowPolicy(),
      observability: makeObs().provider,
      sessionStore: new SessionStore(stateDir),
    });

    const result = await runtime.compactSession("s-missing");
    assert.deepEqual(result, {
      sessionId: "s-missing",
      totalTurns: 0,
      compressed: false,
      forced: true,
      overflowTurns: 0,
      deltaTurns: 0,
      reason: "no_turns",
    });
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("compactSession does not overwrite an existing manifest goal with refinedGoal", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-agent-compact-goal-"));
  try {
    const sessionStore = new SessionStore(stateDir);
    const manifest = await sessionStore.initSession({ sessionId: "s-goal", goal: "keep me" });
    await sessionStore.saveSnapshot(manifest.sessionId, "run-1", {
      sessionId: manifest.sessionId,
      runId: "run-1",
      startedAt: new Date().toISOString(),
      turns: [
        {
          id: "t-1",
          iteration: 1,
          userMessage: "user one",
          assistantMessage: "assistant one",
          toolCalls: [],
          toolResults: [],
        },
        {
          id: "t-2",
          iteration: 2,
          userMessage: "user two",
          assistantMessage: "assistant two",
          toolCalls: [],
          toolResults: [],
        },
      ],
    });

    const runtime = new Agent({
      promptName: "default",
      model: new FakeModel({ assistantMessage: "ok", toolCalls: [], stop: true }),
      modelSelector: new FakeModelSelector(),
      prompts: new FakePromptSource(),
      tools: new ToolRegistry(),
      context: new ContextManager({
        stateDir: path.join(stateDir, "context"),
        maxWorkingTurns: 8,
        compressor: () => ({
          summary: "forced",
          highlights: [],
          supportHistory: [],
          refinedGoal: "new goal",
        }),
      }),
      policy: new AllowPolicy(),
      observability: makeObs().provider,
      sessionStore,
    });

    const result = await runtime.compactSession("s-goal");
    assert.equal(result.compressed, true);
    const updated = await sessionStore.getSession("s-goal");
    assert.equal(updated.goal, "keep me");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("run streams run.failed and rethrows when a step throws", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new ThrowingModel(),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });
  await assert.rejects(() => runtime.run("hello", options), /model exploded/);
  const failed = obs.stream.ofType("run.failed")[0];
  assert.ok(failed, "run.failed must be streamed");
  assert.match(String(failed?.payload.reason ?? ""), /model exploded/);
  assert.equal(
    obs.memory
      .getMetrics()
      .some((m) => m.name === "model.calls" && m.attributes.status === "error"),
    true,
  );
});
