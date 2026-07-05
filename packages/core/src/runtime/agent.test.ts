import assert from "node:assert/strict";
import test from "node:test";
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
import type { ToolPolicyContext, ToolPolicyEngine, ToolPolicyEvaluation } from "../policy/types";
import type { PromptBundle, PromptSource } from "../prompts/types";
import { SkillRegistry } from "../skills/registry";
import { ToolRegistry } from "../tools/registry";
import type { ToolCall, ToolDefinition } from "../tools/types";
import { Agent } from "./agent";
import type { RunState } from "./state";
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

class FakeStreamingModel implements ModelAdapter {
  async nextStep(input: StepInput): Promise<StepPlan> {
    await input.onReasoningDelta?.("thinking...");
    await input.onAssistantDelta?.("hello ");
    await input.onAssistantDelta?.("world");
    return {
      assistantMessage: "hello world",
      toolCalls: [],
      stop: true,
    };
  }
}

class FakePromptSource implements PromptSource {
  async load(_promptName: string, task: string): Promise<PromptBundle> {
    return {
      system: "system",
      instructions: [],
      task,
      metadata: { name: "default" },
    };
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

class FakeEventSink implements EventSink {
  readonly events: ExecutionEvent[] = [];

  async push(event: ExecutionEvent): Promise<void> {
    this.events.push(event);
  }
}

class FakeContextManager {
  setGoal(_goal: string): void {}
  async init(): Promise<void> {}
  async buildWorkingTurns(state: RunState["turns"]): Promise<{
    recentTurns: RunState["turns"];
  }> {
    return { recentTurns: state };
  }
}

const options: RunOptions = {
  maxIterations: 1,
  snapshotEvery: 1,
  profile: { defaultModel: "test-model" } as ModelProfile,
};

test("runtime does not crash on unknown tool", async () => {
  const events = new FakeEventSink();
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
    eventSink: events,
  });

  const state = await runtime.run("hello", options);
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /Unknown tool/i);
});

test("runtime normalizes simple function-style tool names", async () => {
  const events = new FakeEventSink();
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
    eventSink: events,
  });

  const state = await runtime.run("hello", options);
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0]?.toolCalls[0]?.name, "time()");
  assert.equal(state.turns[0]?.toolResults[0]?.ok, true);
  assert.deepEqual(state.turns[0]?.toolResults[0]?.output, { now: "2026-01-01T00:00:00.000Z" });
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
    eventSink: events,
    limits: {
      toolTimeoutMs: 1000,
      maxActionCallsPerRun: 0,
    },
  });

  const state = await runtime.run("hello", options);
  // The over-budget call is recorded as a blocked result (not silently dropped).
  assert.equal(state.turns.length, 1);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /limit/i);
  assert.equal(
    events.events.some((event) => event.type === "run.limit_reached"),
    true,
  );
  assert.equal(
    events.events.some((event) => event.type === "run.completed"),
    true,
  );
});

test("runtime emits model.delta and stream completion events", async () => {
  const events = new FakeEventSink();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeStreamingModel(),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    eventSink: events,
  });

  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.assistantMessage, "hello world");
  const deltaEvents = events.events.filter((event) => event.type === "model.delta");
  assert.equal(deltaEvents.length, 2);
  const reasoningEvents = events.events.filter((event) => event.type === "model.reasoning_delta");
  assert.equal(reasoningEvents.length, 1);
  assert.equal(
    events.events.some((event) => event.type === "model.thinking_started"),
    true,
  );
  assert.equal(
    events.events.some((event) => event.type === "model.thinking_completed"),
    true,
  );
  assert.equal(
    events.events.some((event) => event.type === "model.reasoning_stream_completed"),
    true,
  );
  assert.equal(
    events.events.some((event) => event.type === "model.stream_completed"),
    true,
  );
});

test("runtime passes taskType hint into model selector", async () => {
  const events = new FakeEventSink();
  const selector = new CapturingModelSelector();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "ok",
      toolCalls: [],
      stop: true,
    }),
    modelSelector: selector,
    prompts: new ReasoningPromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    eventSink: events,
  });

  await runtime.run("hello", options);
  assert.equal(selector.seen?.taskType, "reasoning");
  const selected = events.events.find((event) => event.type === "model.selected");
  assert.equal(selected?.payload.taskType, "reasoning");
});

class ApprovalPolicy implements ToolPolicyEngine {
  async evaluate() {
    return { decision: "require_approval" as const, reason: "test approval" };
  }
}

test("approval handler that returns true allows the tool call", async () => {
  const events = new FakeEventSink();
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
    eventSink: events,
    approvalHandler: async () => true,
  });
  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, true);
  assert.equal(
    events.events.some((e) => e.type === "action.approval_approved"),
    true,
  );
});

test("approval handler that returns false blocks the tool call", async () => {
  const events = new FakeEventSink();
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
    eventSink: events,
    approvalHandler: async () => false,
  });
  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /Approval denied/);
});

test("missing approval handler blocks require_approval", async () => {
  const events = new FakeEventSink();
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
    eventSink: events,
  });
  const state = await runtime.run("hello", options);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /no handler/);
});

test("RunOptions.limits overrides runtime default limits per run", async () => {
  const events = new FakeEventSink();
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
    eventSink: events,
    limits: { toolTimeoutMs: 5000, maxActionCallsPerRun: 100 },
  });
  const state = await runtime.run("hello", {
    ...options,
    maxIterations: 3,
    limits: { maxActionCallsPerRun: 1 },
  });
  // Iteration 1 executes the single allowed call (budget 1 → 0).
  // Iteration 2's call is over budget → recorded as a blocked result, then break.
  assert.equal(state.turns.length, 2);
  assert.equal(state.turns[0]?.toolResults[0]?.ok, true);
  assert.equal(state.turns[1]?.toolResults[0]?.ok, false);
  assert.match(state.turns[1]?.toolResults[0]?.error ?? "", /limit/i);
  assert.equal(
    events.events.some((e) => e.type === "run.limit_reached"),
    true,
  );
});

test("invoke adapter returns AgentRunResult with summary", async () => {
  const events = new FakeEventSink();
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "done",
      toolCalls: [],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    eventSink: events,
  });

  const result = await runtime.invoke({
    prompt: "hello",
    execution: options,
  });
  assert.equal(result.summary, "done");
  assert.equal(result.runId.length > 0, true);
});

test("capabilityScope denyActions blocks tool execution", async () => {
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
    eventSink: events,
  });

  const state = await runtime.run("hello", {
    ...options,
    capabilityScope: { denyActions: ["echo"] },
  });
  assert.equal(state.turns[0]?.toolResults[0]?.ok, false);
  assert.match(state.turns[0]?.toolResults[0]?.error ?? "", /out of scope/i);
});

test("runtime executes skillCalls when skill engine is configured", async () => {
  const events = new FakeEventSink();
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
    eventSink: events,
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
  const events = new FakeEventSink();
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
    eventSink: events,
    skills,
  });
  const state = await runtime.run("hello", options);
  assert.equal(ran, false);
  assert.equal(state.turns[0]?.skillResults?.[0]?.ok, false);
  assert.equal(
    events.events.some((e) => e.type === "action.blocked"),
    true,
  );
});

class ThrowingModel implements ModelAdapter {
  async nextStep(_input: StepInput): Promise<StepPlan> {
    throw new Error("model exploded");
  }
}

test("run emits run.failed and rethrows when a step throws", async () => {
  const events = new FakeEventSink();
  const runtime = new Agent({
    promptName: "default",
    model: new ThrowingModel(),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    eventSink: events,
  });
  await assert.rejects(() => runtime.run("hello", options), /model exploded/);
  const failed = events.events.find((e) => e.type === "run.failed");
  assert.ok(failed, "run.failed must be emitted");
  assert.match(String(failed?.payload.reason ?? ""), /model exploded/);
});

test("handleChannel maps channel request to runtime invoke", async () => {
  const runtime = new Agent({
    promptName: "default",
    model: new FakeModel({
      assistantMessage: "channel result",
      toolCalls: [],
      stop: true,
    }),
    modelSelector: new FakeModelSelector(),
    prompts: new FakePromptSource(),
    tools: new ToolRegistry(),
    context: new FakeContextManager() as never,
    policy: new AllowPolicy(),
    eventSink: new FakeEventSink(),
  });
  const response = await runtime.handleChannel({
    input: "hello",
    runOptions: options,
  });
  assert.equal(response.finalMessage, "channel result");
});
