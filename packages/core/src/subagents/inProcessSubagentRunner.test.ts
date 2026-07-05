import assert from "node:assert/strict";
import test from "node:test";
import type { RunState } from "../runtime/state";
import type { AgentHandle, AgentInvokeRequest, AgentRunResult } from "../runtime/types";
import { InProcessSubagentRunner } from "./inProcessSubagentRunner";
import type { SubagentRuntimeFactory } from "./types";

class FakeChildAgent implements AgentHandle {
  readonly id = "child";
  readonly kind = "subagent" as const;
  readonly promptName = "child-agent";
  killed = false;
  seenRequest?: AgentInvokeRequest;
  constructor(
    private readonly state: RunState,
    private readonly delayMs: number = 0,
  ) {}
  async invoke(request: AgentInvokeRequest): Promise<AgentRunResult> {
    this.seenRequest = request;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return {
      summary: this.state.turns[this.state.turns.length - 1]?.assistantMessage ?? "",
      state: this.state,
      runId: this.state.runId,
      sessionId: this.state.sessionId,
    };
  }
  kill(): void {
    this.killed = true;
  }
  get sessionId(): string | undefined {
    return this.state.sessionId;
  }
}

const parent = {
  id: "parent",
  kind: "main",
  promptName: "main",
  sessionId: "parent-session",
  async invoke() {
    throw new Error("not used");
  },
  kill() {},
} as AgentHandle;

test("returns final assistantMessage as summary", async () => {
  const child = new FakeChildAgent({
    sessionId: "child",
    runId: "r",
    startedAt: "t",
    turns: [
      {
        id: "1",
        iteration: 1,
        userMessage: "u",
        assistantMessage: "first",
        toolCalls: [],
        toolResults: [],
      },
      {
        id: "2",
        iteration: 2,
        userMessage: "u",
        assistantMessage: "last summary",
        toolCalls: [],
        toolResults: [],
      },
    ],
  });
  const factory: SubagentRuntimeFactory = {
    build: () => ({
      agent: child,
      runOptions: { maxIterations: 2, snapshotEvery: 1, profile: { defaultModel: "m" } },
      prompt: "do the thing",
    }),
  };
  const runner = new InProcessSubagentRunner(factory, parent);
  const result = await runner.run({ prompt: "do the thing" });
  assert.equal(result.summary, "last summary");
  assert.equal(child.seenRequest?.prompt, "do the thing");
});

test("empty turns produces empty summary", async () => {
  const child = new FakeChildAgent({ sessionId: "c", runId: "r", startedAt: "t", turns: [] });
  const factory: SubagentRuntimeFactory = {
    build: () => ({
      agent: child,
      runOptions: { maxIterations: 1, snapshotEvery: 1, profile: { defaultModel: "m" } },
      prompt: "p",
    }),
  };
  const runner = new InProcessSubagentRunner(factory, parent);
  const result = await runner.run({ prompt: "p" });
  assert.equal(result.summary, "");
});

test("abort signal kills the child agent", async () => {
  const child = new FakeChildAgent({ sessionId: "c", runId: "r", startedAt: "t", turns: [] }, 30);
  const factory: SubagentRuntimeFactory = {
    build: () => ({
      agent: child,
      runOptions: { maxIterations: 1, snapshotEvery: 1, profile: { defaultModel: "m" } },
      prompt: "p",
    }),
  };
  const runner = new InProcessSubagentRunner(factory, parent);
  const controller = new AbortController();
  const promise = runner.run({ prompt: "p", signal: controller.signal });
  controller.abort();
  await promise;
  assert.equal(child.killed, true);
});

test("factory receives the parent agent", async () => {
  let capturedParent: AgentHandle | undefined;
  const child = new FakeChildAgent({ sessionId: "c", runId: "r", startedAt: "t", turns: [] });
  const factory: SubagentRuntimeFactory = {
    build: (_options, p) => {
      capturedParent = p;
      return {
        agent: child,
        runOptions: { maxIterations: 1, snapshotEvery: 1, profile: { defaultModel: "m" } },
        prompt: "p",
      };
    },
  };
  const runner = new InProcessSubagentRunner(factory, parent);
  await runner.run({ prompt: "p" });
  assert.equal(capturedParent, parent);
});
