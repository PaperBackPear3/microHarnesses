import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CredentialsRegistry } from "../providers/credentialsRegistry";
import { ProviderRegistry } from "../providers/registry";
import type {
  CompletionRequest,
  CredentialsResolver,
  ProviderAdapter,
  ProviderAuth,
  ProviderResponse,
  ProviderStreamEvent,
} from "../providers/types";
import { ConfigError } from "../shared/errors";
import { ProviderModelAdapter } from "./providerModelAdapter";
import type { StepInput } from "./types";

class FakeAdapter implements ProviderAdapter {
  readonly providerId = "fake";
  features?: ProviderAdapter["features"];
  constructor(
    readonly defaultModel: string | undefined,
    private readonly response: ProviderResponse,
    options: { structuredTools?: boolean } = {},
  ) {
    this.features = { structuredTools: options.structuredTools ?? false };
  }
  seenRequest?: CompletionRequest;
  seenAuth?: ProviderAuth;
  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    this.seenRequest = request;
    this.seenAuth = auth;
    return this.response;
  }
}

class FakeStreamingAdapter implements ProviderAdapter {
  readonly providerId = "fake-stream";
  readonly defaultModel = "fake-stream-model";
  readonly features = { structuredTools: true };
  seenRequest?: CompletionRequest;
  seenAuth?: ProviderAuth;

  async *streamComplete(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent> {
    this.seenRequest = request;
    this.seenAuth = auth;
    yield { type: "reasoning.delta", delta: "thinking..." };
    yield { type: "assistant.delta", delta: "hel" };
    yield { type: "assistant.delta", delta: "lo" };
    yield {
      type: "final",
      response: { assistantMessage: "hello", toolCalls: [], stop: true },
    };
  }

  async complete(_request: CompletionRequest, _auth: ProviderAuth): Promise<ProviderResponse> {
    throw new Error("complete should not be called when streamComplete exists");
  }
}

class FakeCreds implements CredentialsResolver {
  async resolve(): Promise<ProviderAuth> {
    return { apiKey: "test-key", baseUrl: "https://example.test" };
  }
}

function makeInput(overrides: Partial<StepInput> = {}): StepInput {
  return {
    promptName: "a",
    userPrompt: "hello",
    bundle: {
      system: "sys",
      instructions: [],
      task: "task",
      metadata: { name: "default" },
    },
    workingTurns: [],
    iteration: 1,
    ...overrides,
  };
}

function contentText(
  content: string | Array<{ type: "text"; text: string } | { type: string }>,
): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => ("type" in part && part.type === "text" && "text" in part ? part.text : ""))
    .join("");
}

test("resolves model precedence: selectedModel > constructor model > defaultModel", async () => {
  const adapter = new FakeAdapter("adapter-default", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
    model: "ctor",
  });

  await model.nextStep(makeInput({ selectedModel: "runtime-pick" }));
  assert.equal(adapter.seenRequest?.model, "runtime-pick");

  await model.nextStep(makeInput());
  assert.equal(adapter.seenRequest?.model, "ctor");
});

test("prefers a routed selectedProviderId over the static/dynamic provider selection", async () => {
  const fakeAdapter = new FakeAdapter("fake-default", {
    assistantMessage: "from-fake",
    toolCalls: [],
    stop: true,
  });
  const otherAdapter = new FakeAdapter("other-default", {
    assistantMessage: "from-other",
    toolCalls: [],
    stop: true,
  });
  Object.defineProperty(otherAdapter, "providerId", { value: "other" });
  const providers = new ProviderRegistry();
  providers.register(fakeAdapter);
  providers.register(otherAdapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());
  creds.register("other", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(makeInput({ selectedProviderId: "other", selectedModel: "routed-model" }));
  assert.equal(otherAdapter.seenRequest?.model, "routed-model");
  assert.equal(fakeAdapter.seenRequest, undefined);
});

test("prefers a routed selectedMaxTokens over the static/dynamic maxTokens", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
    maxTokens: 4096,
  });

  await model.nextStep(makeInput({ selectedMaxTokens: 512 }));
  assert.equal(adapter.seenRequest?.maxTokens, 512);
});

test("falls back to adapter.defaultModel when no other model is available", async () => {
  const adapter = new FakeAdapter("adapter-default", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(makeInput());
  assert.equal(adapter.seenRequest?.model, "adapter-default");
});

test("throws ConfigError when no model can be resolved anywhere", async () => {
  const adapter = new FakeAdapter(undefined, {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await assert.rejects(() => model.nextStep(makeInput()), ConfigError);
});

test("threads usage and malformedInput back into StepPlan", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "hi",
    toolCalls: [
      { name: "t", input: { raw: "bad" }, malformedInput: true },
      { name: "t2", input: { x: 1 } },
    ],
    stop: false,
    usage: { inputTokens: 5, outputTokens: 3 },
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  const plan = await model.nextStep(makeInput());
  assert.equal(plan.toolCalls[0]?.malformedInput, true);
  assert.equal(plan.toolCalls[1]?.malformedInput, undefined);
  assert.deepEqual(plan.usage, { inputTokens: 5, outputTokens: 3 });
});

test("forwards non-stream reasoning content when provider returns it", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "answer",
    reasoningMessage: "thinking trail",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  const reasoning: string[] = [];
  const assistant: string[] = [];
  await model.nextStep(
    makeInput({
      onReasoningDelta: (delta) => {
        reasoning.push(delta);
      },
      onAssistantDelta: (delta) => {
        assistant.push(delta);
      },
    }),
  );

  assert.deepEqual(reasoning, ["thinking trail"]);
  assert.deepEqual(assistant, ["answer"]);
});

test("uses streamComplete and forwards assistant deltas", async () => {
  const adapter = new FakeStreamingAdapter();
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake-stream", new FakeCreds());
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake-stream",
  });

  const deltas: string[] = [];
  const reasoning: string[] = [];
  const plan = await model.nextStep(
    makeInput({
      onAssistantDelta: (delta) => {
        deltas.push(delta);
      },
      onReasoningDelta: (delta) => {
        reasoning.push(delta);
      },
    }),
  );

  assert.deepEqual(reasoning, ["thinking..."]);
  assert.deepEqual(deltas, ["hel", "lo"]);
  assert.equal(plan.assistantMessage, "hello");
  assert.equal(plan.stop, true);
});

test("passes availableTools in completion request", async () => {
  const adapter = new FakeAdapter(
    "m",
    {
      assistantMessage: "ok",
      toolCalls: [],
      stop: true,
    },
    { structuredTools: true },
  );
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      availableTools: [{ name: "time", description: "d", inputSchema: { type: "object" } }],
    }),
  );

  assert.deepEqual(adapter.seenRequest?.tools, [
    { name: "time", description: "d", inputSchema: { type: "object" } },
  ]);
});

test("injects only skill discovery instructions without enumerating skill names", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      availableSkills: ["create-mcp-app", "aws-iam"],
    }),
  );

  const system = contentText(adapter.seenRequest?.messages[0]?.content ?? "");
  assert.match(system, /Skill discovery/);
  assert.match(system, /list_skills/);
  assert.match(system, /find_skill/);
  assert.match(system, /skill/);
  assert.doesNotMatch(system, /create-mcp-app/);
  assert.doesNotMatch(system, /aws-iam/);
});

test("injects fallback tool catalog for providers without structured tools", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      availableTools: [
        { name: "time", description: "Returns time", inputSchema: { type: "object" } },
      ],
    }),
  );

  const system = contentText(adapter.seenRequest?.messages[0]?.content ?? "");
  assert.match(system, /Runtime tool catalog/);
  assert.match(system, /time/);
  assert.match(system, /Do not append parentheses/);
});

test("does not inject fallback tool catalog for structured-tools providers", async () => {
  const adapter = new FakeAdapter(
    "m",
    {
      assistantMessage: "ok",
      toolCalls: [],
      stop: true,
    },
    { structuredTools: true },
  );
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      availableTools: [
        { name: "time", description: "Returns time", inputSchema: { type: "object" } },
      ],
    }),
  );

  const system = contentText(adapter.seenRequest?.messages[0]?.content ?? "");
  assert.doesNotMatch(system, /Runtime tool catalog/);
});

test("includes prior tool execution feedback in subsequent messages", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      workingTurns: [
        {
          id: "t1",
          iteration: 1,
          userMessage: "Use time, then echo",
          assistantMessage: "",
          toolCalls: [{ name: "time", input: {} }],
          toolResults: [{ ok: true, output: { now: "2026-01-01T00:00:00.000Z" } }],
        },
      ],
    }),
  );

  const feedback = adapter.seenRequest?.messages.find((m) =>
    contentText(m.content).includes("Tool execution feedback from the previous step:"),
  );
  assert.ok(feedback);
  assert.equal(feedback?.role, "user");
  assert.match(contentText(feedback?.content ?? ""), /time/);
  assert.match(contentText(feedback?.content ?? ""), /2026-01-01T00:00:00.000Z/);
});

test("tool feedback includes long shell stdout for file lists", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  const fileList = Array.from({ length: 140 }, (_, i) => `packages/core/src/file-${i}.ts`).join(
    "\n",
  );
  await model.nextStep(
    makeInput({
      workingTurns: [
        {
          id: "t1",
          iteration: 1,
          userMessage: "List changed files",
          assistantMessage: "",
          toolCalls: [
            { name: "shell_exec", input: { command: "git diff --name-only HEAD^ HEAD" } },
          ],
          toolResults: [
            {
              ok: true,
              output: {
                stdout: fileList,
                stderr: "",
                truncated: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                exitCode: 0,
              },
            },
          ],
        },
      ],
    }),
  );

  const feedback = adapter.seenRequest?.messages.find((m) =>
    contentText(m.content).includes("Tool execution feedback from the previous step:"),
  );
  assert.ok(feedback);
  assert.match(contentText(feedback?.content ?? ""), /file-139\.ts/);
});

test("tool feedback includes tool_output_read hints when artifacts are present", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      workingTurns: [
        {
          id: "t1",
          iteration: 1,
          userMessage: "Show the patch",
          assistantMessage: "",
          toolCalls: [{ name: "shell_exec", input: { command: "git show -p" } }],
          toolResults: [
            {
              ok: true,
              output: {
                stdout: "partial output",
                stdoutTruncated: true,
                truncated: true,
                stdoutArtifact: { id: "artifact-1", path: "artifact-1.txt" },
              },
            },
          ],
        },
      ],
    }),
  );

  const feedback = adapter.seenRequest?.messages.find((m) =>
    contentText(m.content).includes("Tool execution feedback from the previous step:"),
  );
  assert.ok(feedback);
  assert.match(contentText(feedback?.content ?? ""), /tool_output_read id=artifact-1/);
});

test("adds session continuity instruction when working turns exist", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      workingTurns: [
        {
          id: "t1",
          iteration: 1,
          userMessage: "What did we discuss?",
          assistantMessage: "We discussed X.",
          toolCalls: [],
          toolResults: [],
        },
      ],
    }),
  );

  const continuityInstruction = adapter.seenRequest?.messages.find(
    (message) =>
      message.role === "developer" &&
      contentText(message.content).includes("Session history from prior turns is included below"),
  );
  assert.ok(continuityInstruction);
});

test("injects runtimeInstructions as developer messages without mutating task text", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      bundle: {
        system: "sys",
        instructions: [],
        task: "create it",
        metadata: { name: "default" },
      },
      runtimeInstructions: ["Autopilot contract:\n- Continue autonomously.", "   "],
    }),
  );

  const contractInstruction = adapter.seenRequest?.messages.find(
    (message) =>
      message.role === "developer" && contentText(message.content).includes("Autopilot contract:"),
  );
  assert.ok(contractInstruction);

  const userMessages = (adapter.seenRequest?.messages ?? []).filter(
    (message) => message.role === "user",
  );
  const taskMentions = userMessages.filter(
    (message) => contentText(message.content) === "create it",
  );
  assert.equal(taskMentions.length, 1);
});

test("reinjects the compression summary of older turns as prior context", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      summary: {
        summary: "Earlier we chose PostgreSQL.",
        highlights: ["db=postgres"],
        supportHistory: [],
      },
    }),
  );

  const summaryMessage = adapter.seenRequest?.messages.find(
    (message) =>
      message.role === "developer" &&
      contentText(message.content).includes("Summary of earlier turns"),
  );
  assert.ok(summaryMessage, "compression summary must be reinjected");
  assert.match(contentText(summaryMessage?.content ?? ""), /Earlier we chose PostgreSQL\./);
  assert.match(contentText(summaryMessage?.content ?? ""), /db=postgres/);
});

test("does not append duplicate task message when latest turn already has same user prompt", async () => {
  const adapter = new FakeAdapter("m", {
    assistantMessage: "ok",
    toolCalls: [],
    stop: true,
  });
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());

  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await model.nextStep(
    makeInput({
      bundle: {
        system: "sys",
        instructions: [],
        task: "Use time then echo",
        metadata: { name: "default" },
      },
      workingTurns: [
        {
          id: "t1",
          iteration: 1,
          userMessage: "Use time then echo",
          assistantMessage: "",
          toolCalls: [{ name: "time", input: {} }],
          toolResults: [{ ok: true, output: { now: "2026-01-01T00:00:00.000Z" } }],
        },
      ],
    }),
  );

  const userMessages = (adapter.seenRequest?.messages ?? []).filter((m) => m.role === "user");
  const taskMentions = userMessages.filter((m) => contentText(m.content) === "Use time then echo");
  assert.equal(taskMentions.length, 1);
});

test("emits structured provider content parts for multimodal user turns", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mh-provider-model-multimodal-"));
  const adapter = new FakeAdapter(
    "m",
    { assistantMessage: "ok", toolCalls: [], stop: true },
    { structuredTools: true },
  );
  adapter.features = { structuredTools: true, inputParts: { text: true, image: true, file: true } };
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });
  try {
    const imagePath = path.join(tmpDir, "photo.png");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await model.nextStep(
      makeInput({
        workingTurns: [
          {
            id: "t1",
            iteration: 1,
            userMessage: "Analyze",
            userContent: [
              { type: "text", text: "Analyze this image" },
              { type: "image", assetId: "asset-1", mimeType: "image/png" },
            ],
            assistantMessage: "",
            toolCalls: [],
            toolResults: [],
          },
        ],
        resolveInputAsset: async (assetId) =>
          assetId === "asset-1"
            ? {
                id: "asset-1",
                filename: "photo.png",
                mimeType: "image/png",
                sizeBytes: 4,
                storagePath: imagePath,
                createdAt: new Date().toISOString(),
              }
            : undefined,
      }),
    );

    const userMessage = adapter.seenRequest?.messages.find((m) => m.role === "user");
    assert.ok(userMessage);
    assert.ok(Array.isArray(userMessage?.content));
    if (Array.isArray(userMessage?.content)) {
      assert.equal(userMessage.content[0]?.type, "text");
      assert.equal(userMessage.content[1]?.type, "image");
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("prepends userMessage text to image-only userContent so instructions reach the model", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mh-provider-model-textimg-"));
  const adapter = new FakeAdapter(
    "m",
    { assistantMessage: "ok", toolCalls: [], stop: true },
    { structuredTools: true },
  );
  adapter.features = {
    structuredTools: true,
    inputParts: { text: true, image: true, file: false },
  };
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });
  try {
    const imagePath = path.join(tmpDir, "crossword.png");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await model.nextStep(
      makeInput({
        workingTurns: [
          {
            id: "t1",
            iteration: 1,
            // Instructions in userMessage, media-only in userContent
            userMessage: "Analyze the attached image and return strict JSON.",
            userContent: [{ type: "image", assetId: "asset-1", mimeType: "image/png" }],
            assistantMessage: "",
            toolCalls: [],
            toolResults: [],
          },
        ],
        resolveInputAsset: async (assetId) =>
          assetId === "asset-1"
            ? {
                id: "asset-1",
                filename: "crossword.png",
                mimeType: "image/png",
                sizeBytes: 4,
                storagePath: imagePath,
                createdAt: new Date().toISOString(),
              }
            : undefined,
      }),
    );

    // The user message must contain BOTH the instruction text AND the image
    const userMessage = adapter.seenRequest?.messages.find((m) => m.role === "user");
    assert.ok(userMessage, "user message expected");
    assert.ok(Array.isArray(userMessage?.content), "content should be an array (multimodal)");
    if (Array.isArray(userMessage?.content)) {
      assert.equal(userMessage.content[0]?.type, "text", "first part should be text instruction");
      assert.equal(
        (userMessage.content[0] as { type: string; text?: string }).text,
        "Analyze the attached image and return strict JSON.",
      );
      assert.equal(userMessage.content[1]?.type, "image", "second part should be image");
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("rejects multimodal input when provider does not declare support", async () => {
  const adapter = new FakeAdapter("m", { assistantMessage: "ok", toolCalls: [], stop: true });
  adapter.features = {
    structuredTools: true,
    inputParts: { text: true, image: false, file: false },
  };
  const providers = new ProviderRegistry();
  providers.register(adapter);
  const creds = new CredentialsRegistry();
  creds.register("fake", new FakeCreds());
  const model = new ProviderModelAdapter({
    providerRegistry: providers,
    credentialsRegistry: creds,
    providerId: "fake",
  });

  await assert.rejects(
    () =>
      model.nextStep(
        makeInput({
          workingTurns: [
            {
              id: "t1",
              iteration: 1,
              userMessage: "Analyze",
              userContent: [{ type: "image", assetId: "asset-1", mimeType: "image/png" }],
              assistantMessage: "",
              toolCalls: [],
              toolResults: [],
            },
          ],
          resolveInputAsset: async () => ({
            id: "asset-1",
            filename: "photo.png",
            mimeType: "image/png",
            sizeBytes: 4,
            storagePath: "/tmp/photo.png",
            createdAt: new Date().toISOString(),
          }),
        }),
      ),
    /does not support image input parts/,
  );
});
