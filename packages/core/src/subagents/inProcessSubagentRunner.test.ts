import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessState } from "../context/types";
import type { HarnessRuntime } from "../runtime/runtime";
import type { RunOptions } from "../runtime/types";
import { InProcessSubagentRunner } from "./inProcessSubagentRunner";
import type { SubagentRuntimeFactory } from "./types";

class FakeChildRuntime {
  killed = false;
  seenAgent?: string;
  seenPrompt?: string;
  seenOptions?: RunOptions;
  constructor(
    private readonly state: HarnessState,
    private readonly delayMs: number = 0,
  ) {}
  async run(agent: string, prompt: string, options: RunOptions): Promise<HarnessState> {
    this.seenAgent = agent;
    this.seenPrompt = prompt;
    this.seenOptions = options;
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return this.state;
  }
  kill(): void {
    this.killed = true;
  }
  get sessionId(): string | undefined {
    return this.state.sessionId;
  }
}

const parent = { sessionId: "parent-session" } as unknown as HarnessRuntime;

test("returns final assistantMessage as summary", async () => {
  const child = new FakeChildRuntime({
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
      runtime: child as unknown as HarnessRuntime,
      runOptions: { maxIterations: 2, snapshotEvery: 1, profile: { defaultModel: "m" } },
      agentName: "child-agent",
      prompt: "do the thing",
    }),
  };
  const runner = new InProcessSubagentRunner(factory, parent);
  const result = await runner.run({ prompt: "do the thing" });
  assert.equal(result.summary, "last summary");
  assert.equal(child.seenAgent, "child-agent");
});

test("empty turns produces empty summary", async () => {
  const child = new FakeChildRuntime({ sessionId: "c", runId: "r", startedAt: "t", turns: [] });
  const factory: SubagentRuntimeFactory = {
    build: () => ({
      runtime: child as unknown as HarnessRuntime,
      runOptions: { maxIterations: 1, snapshotEvery: 1, profile: { defaultModel: "m" } },
      agentName: "a",
      prompt: "p",
    }),
  };
  const runner = new InProcessSubagentRunner(factory, parent);
  const result = await runner.run({ prompt: "p" });
  assert.equal(result.summary, "");
});

test("abort signal kills the child runtime", async () => {
  const child = new FakeChildRuntime({ sessionId: "c", runId: "r", startedAt: "t", turns: [] }, 30);
  const factory: SubagentRuntimeFactory = {
    build: () => ({
      runtime: child as unknown as HarnessRuntime,
      runOptions: { maxIterations: 1, snapshotEvery: 1, profile: { defaultModel: "m" } },
      agentName: "a",
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

test("factory receives the parent runtime", async () => {
  let capturedParent: HarnessRuntime | undefined;
  const child = new FakeChildRuntime({ sessionId: "c", runId: "r", startedAt: "t", turns: [] });
  const factory: SubagentRuntimeFactory = {
    build: (_options, p) => {
      capturedParent = p;
      return {
        runtime: child as unknown as HarnessRuntime,
        runOptions: { maxIterations: 1, snapshotEvery: 1, profile: { defaultModel: "m" } },
        agentName: "a",
        prompt: "p",
      };
    },
  };
  const runner = new InProcessSubagentRunner(factory, parent);
  await runner.run({ prompt: "p" });
  assert.equal(capturedParent, parent);
});
