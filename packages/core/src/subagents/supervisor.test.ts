import assert from "node:assert/strict";
import test from "node:test";
import type { RunState } from "../runtime/state";
import type { AgentHandle, AgentInvokeRequest, AgentRunResult } from "../runtime/types";
import { InProcessSubagentSupervisor } from "./supervisor";
import type { SubagentRuntimeFactory } from "./types";

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (error: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class FakeChildAgent implements AgentHandle {
  readonly id: string;
  readonly kind = "subagent" as const;
  readonly promptName = "child";
  killed = false;
  seenRequest?: AgentInvokeRequest;

  constructor(
    id: string,
    private readonly deferred: Deferred<AgentRunResult>,
  ) {
    this.id = id;
  }

  async invoke(request: AgentInvokeRequest): Promise<AgentRunResult> {
    this.seenRequest = request;
    return await this.deferred.promise;
  }

  kill(): void {
    this.killed = true;
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

test("wait next returns completions in deterministic finish order", async () => {
  const first = new Deferred<AgentRunResult>();
  const second = new Deferred<AgentRunResult>();
  const deferreds = [first, second];
  const factory = factoryFor(deferreds);
  const supervisor = new InProcessSubagentSupervisor(factory, parent, {
    idFactory: sequentialIds(),
    now: sequentialTimes(),
  });

  const a = await supervisor.spawn({ name: "first worker", prompt: "a", promptName: "alpha" });
  const b = await supervisor.spawn({ prompt: "b", promptName: "beta" });
  assert.deepEqual([a.id, b.id], ["subagent-1", "subagent-2"]);

  second.resolve(result("child-2", "second done"));
  const next = await supervisor.wait({ mode: "next" });

  assert.equal(next.completed.length, 1);
  assert.equal(next.completed[0]?.id, "subagent-2");
  assert.equal(next.completed[0]?.summary, "second done");
  assert.equal(next.running[0]?.name, "first worker");
  assert.deepEqual(
    next.running.map((entry) => entry.id),
    ["subagent-1"],
  );

  first.resolve(result("child-1", "first done"));
  const remaining = await supervisor.wait({ mode: "next" });
  assert.deepEqual(
    remaining.completed.map((entry) => entry.id),
    ["subagent-1"],
  );
  assert.equal(remaining.completed[0]?.name, "first worker");
  assert.equal(remaining.running.length, 0);
});

test("wait all joins the selected running snapshot", async () => {
  const first = new Deferred<AgentRunResult>();
  const second = new Deferred<AgentRunResult>();
  const supervisor = new InProcessSubagentSupervisor(factoryFor([first, second]), parent, {
    idFactory: sequentialIds(),
    now: sequentialTimes(),
  });

  await supervisor.spawn({ prompt: "a" });
  await supervisor.spawn({ prompt: "b" });

  const waiting = supervisor.wait({ mode: "all" });
  second.resolve(result("child-2", "second"));
  first.resolve(result("child-1", "first"));
  const joined = await waiting;

  assert.deepEqual(
    joined.completed.map((entry) => entry.summary),
    ["second", "first"],
  );
  assert.equal(joined.running.length, 0);
});

test("failed subagents are returned as completed wait records", async () => {
  const failure = new Deferred<AgentRunResult>();
  const supervisor = new InProcessSubagentSupervisor(factoryFor([failure]), parent, {
    idFactory: sequentialIds(),
    now: sequentialTimes(),
  });

  await supervisor.spawn({ prompt: "fail" });
  failure.reject(new Error("boom"));

  const waited = await supervisor.wait({ mode: "next" });
  assert.equal(waited.completed[0]?.status, "failed");
  assert.equal(waited.completed[0]?.error, "boom");
});

test("completed subagents fallback to last non-empty assistant message when summary is empty", async () => {
  const completion = new Deferred<AgentRunResult>();
  const supervisor = new InProcessSubagentSupervisor(factoryFor([completion]), parent, {
    idFactory: sequentialIds(),
    now: sequentialTimes(),
  });

  await supervisor.spawn({ prompt: "work" });
  completion.resolve({
    summary: "",
    state: {
      sessionId: "child-1",
      runId: "run-child-1",
      startedAt: "start",
      turns: [
        {
          id: "t-1",
          iteration: 1,
          userMessage: "u",
          assistantMessage: "intermediate answer",
          toolCalls: [],
          toolResults: [],
        },
        {
          id: "t-2",
          iteration: 2,
          userMessage: "",
          assistantMessage: "",
          toolCalls: [],
          toolResults: [],
        },
      ],
    },
    runId: "run-child-1",
    sessionId: "child-1",
  });

  const waited = await supervisor.wait({ mode: "next" });
  assert.equal(waited.completed[0]?.summary, "intermediate answer");
});

function factoryFor(deferreds: Deferred<AgentRunResult>[]): SubagentRuntimeFactory {
  let index = 0;
  return {
    build(request) {
      const childIndex = index++;
      const sessionId = `child-${childIndex + 1}`;
      return {
        agent: new FakeChildAgent(sessionId, deferreds[childIndex] as Deferred<AgentRunResult>),
        prompt: request.prompt,
        runOptions: {
          maxIterations: 1,
          snapshotEvery: 1,
          profile: { defaultModel: "m" },
          sessionId,
        },
      };
    },
  };
}

function result(sessionId: string, summary: string): AgentRunResult {
  const state: RunState = {
    sessionId,
    runId: `run-${sessionId}`,
    startedAt: "start",
    turns: [
      {
        id: "turn",
        iteration: 1,
        userMessage: "",
        assistantMessage: summary,
        toolCalls: [],
        toolResults: [],
      },
    ],
  };
  return { summary, state, runId: state.runId, sessionId };
}

function sequentialIds(): () => string {
  let next = 0;
  return () => `subagent-${++next}`;
}

function sequentialTimes(): () => string {
  let next = 0;
  return () => `2026-01-01T00:00:0${++next}.000Z`;
}
