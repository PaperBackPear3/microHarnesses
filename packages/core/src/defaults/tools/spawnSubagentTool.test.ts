import assert from "node:assert/strict";
import test from "node:test";
import {
  createSpawnSubagentTool,
  createWaitSubagentsTool,
  parseModelInput,
} from "./spawnSubagentTool";

// ── parseModelInput unit tests ────────────────────────────────────────────────

test("parseModelInput returns model-only for plain ids", () => {
  assert.deepEqual(parseModelInput("gpt-5.4-mini"), { model: "gpt-5.4-mini" });
  assert.deepEqual(parseModelInput("lfm2.5:8b"), { model: "lfm2.5:8b" });
});

test("parseModelInput splits provider-qualified ids on first slash", () => {
  assert.deepEqual(parseModelInput("ollama/lfm2.5:8b"), {
    providerId: "ollama",
    model: "lfm2.5:8b",
  });
  assert.deepEqual(parseModelInput("anthropic/claude-haiku-4-5"), {
    providerId: "anthropic",
    model: "claude-haiku-4-5",
  });
});

test("parseModelInput only splits on the first slash, preserving model tags", () => {
  // A hypothetical deeply-namespaced id should only split once.
  assert.deepEqual(parseModelInput("registry/ns/model:v1"), {
    providerId: "registry",
    model: "ns/model:v1",
  });
});

// ── spawn_subagent tool tests ─────────────────────────────────────────────────

function makeSubagentStub(onSpawn: (opts: Record<string, unknown>) => void) {
  return {
    async run() {
      throw new Error("not used");
    },
    async spawn(options: unknown) {
      onSpawn(options as Record<string, unknown>);
      return { id: "sub-1", launchIndex: 1, status: "running" as const };
    },
    async wait() {
      return { completed: [], running: [] };
    },
    list() {
      return [];
    },
  };
}

test("spawn_subagent forwards name and promptName separately", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
  );

  const result = await tool.execute({ name: "letter echo", promptName: "coder", prompt: "echo m" });

  assert.equal(captured?.name, "letter echo");
  assert.equal(captured?.promptName, "coder");
  assert.equal(captured?.model, undefined);
  assert.equal(result.name, "letter echo");
});

test("spawn_subagent forwards explicit model id without provider", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
  );

  await tool.execute({ prompt: "summarise this", model: "gpt-5.4-mini" });

  assert.equal(captured?.model, "gpt-5.4-mini");
  assert.equal(captured?.providerId, undefined);
});

test("spawn_subagent parses provider-qualified model and forwards both fields", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
  );

  await tool.execute({ prompt: "calculate 5+5", model: "ollama/lfm2.5:8b" });

  assert.equal(captured?.model, "lfm2.5:8b");
  assert.equal(captured?.providerId, "ollama");
});

test("spawn_subagent explicit providerId overrides the one parsed from model string", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
  );

  await tool.execute({ prompt: "p", model: "openai/gpt-5.4", providerId: "my-openai-proxy" });

  assert.equal(captured?.model, "gpt-5.4");
  assert.equal(captured?.providerId, "my-openai-proxy");
});

test("spawn_subagent forwards routingPreference and effort", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
  );

  await tool.execute({ prompt: "p", routingPreference: "cost", effort: "low" });

  assert.equal(captured?.routingPreference, "cost");
  assert.equal(captured?.effort, "low");
});

test("spawn_subagent ignores unknown routingPreference and effort values", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
  );

  await tool.execute({
    prompt: "p",
    routingPreference: "turbo" as never,
    effort: "extreme" as never,
  });

  assert.equal(captured?.routingPreference, undefined);
  assert.equal(captured?.effort, undefined);
});

test("spawn_subagent compatibility: provider-qualified promptName is treated as model override", async () => {
  // This is the exact failure mode that was reported: a model passed the
  // model id as promptName instead of as model.
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
    { defaultPromptName: "coder" },
  );

  await tool.execute({ prompt: "What is 5 + 5?", promptName: "ollama/lfm2.5:8b" });

  // The model/provider are extracted from the promptName…
  assert.equal(captured?.model, "lfm2.5:8b");
  assert.equal(captured?.providerId, "ollama");
  // …and the persona falls back to the default (not the invalid promptName).
  assert.equal(captured?.promptName, "coder");
});

test("spawn_subagent compatibility: anthropic-qualified promptName is treated as model override", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
    { defaultPromptName: "coder" },
  );

  await tool.execute({ prompt: "review this", promptName: "anthropic/claude-haiku-4-5" });

  assert.equal(captured?.model, "claude-haiku-4-5");
  assert.equal(captured?.providerId, "anthropic");
  assert.equal(captured?.promptName, "coder");
});

test("spawn_subagent compatibility does not fire when model is already set explicitly", async () => {
  // If both model and a provider-qualified promptName are supplied, model
  // takes precedence and promptName is forwarded as-is (will fail prompt-pack
  // validation in the CLI factory, which is the correct behavior).
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
  );

  await tool.execute({ prompt: "p", model: "gpt-5.4", promptName: "ollama/lfm2.5:8b" });

  // model came from the explicit field, not from promptName.
  assert.equal(captured?.model, "gpt-5.4");
  // The slash-containing promptName is forwarded unchanged to be rejected by
  // the runtime's persona resolver.
  assert.equal(captured?.promptName, "ollama/lfm2.5:8b");
});

test("spawn_subagent forwards assigned todos", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool(
    makeSubagentStub((o) => {
      captured = o;
    }),
  );

  await tool.execute({
    prompt: "implement assigned work",
    assignedTodos: [
      { id: "a", text: "Build A", priority: 10 },
      "Build B",
      { id: "bad", text: "   " },
    ],
  });

  assert.deepEqual(captured?.assignedTodos, [
    { id: "a", text: "Build A", priority: 10 },
    { text: "Build B" },
  ]);
});

// ── wait_subagents tool tests ─────────────────────────────────────────────────

test("wait_subagents is cancellation-only and returns wait results", async () => {
  const tool = createWaitSubagentsTool({
    async run() {
      throw new Error("not used");
    },
    async spawn() {
      throw new Error("not used");
    },
    async wait() {
      return {
        completed: [
          {
            id: "sub-1",
            launchIndex: 1,
            prompt: "p",
            status: "completed",
            startedAt: "t",
            state: { runId: "r", startedAt: "s", turns: [] },
          },
        ],
        running: [],
      };
    },
    list() {
      return [];
    },
  });

  assert.equal(tool.executionTimeoutMs, "none");
  const result = await tool.execute({ mode: "next" });
  assert.equal(result.remaining, 0);
  const completed = result.completed;
  assert.equal(Array.isArray(completed), true);
  assert.equal((completed as unknown[]).length, 1);
  assert.deepEqual((completed as Array<{ state?: unknown }>)[0]?.state, {
    runId: "r",
    startedAt: "s",
    turns: [],
  });
});
