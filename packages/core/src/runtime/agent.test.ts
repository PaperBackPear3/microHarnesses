import assert from "node:assert/strict";
import test from "node:test";
import type {
  ModelAdapter,
  ModelProfile,
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
import { SkillRegistry } from "../skills/registry";
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
  async buildWorkingTurns(state: RunState["turns"]): Promise<{ recentTurns: RunState["turns"] }> {
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

test("handleChannel maps channel request to runtime invoke", async () => {
  const obs = makeObs();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({ assistantMessage: "channel result", toolCalls: [], stop: true }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    observability: obs.provider,
  });
  const response = await runtime.handleChannel({ input: "hello", runOptions: options });
  assert.equal(response.finalMessage, "channel result");
});
