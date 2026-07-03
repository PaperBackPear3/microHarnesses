import assert from "node:assert/strict";
import test from "node:test";
import { CredentialsRegistry } from "../providers/credentialsRegistry";
import { ProviderRegistry } from "../providers/registry";
import type {
  CompletionRequest,
  CredentialsResolver,
  ProviderAdapter,
  ProviderAuth,
  ProviderResponse,
} from "../providers/types";
import { ConfigError } from "../shared/errors";
import { ProviderModelAdapter } from "./providerModelAdapter";
import type { StepInput } from "./types";

class FakeAdapter implements ProviderAdapter {
  readonly providerId = "fake";
  constructor(
    readonly defaultModel: string | undefined,
    private readonly response: ProviderResponse,
  ) {}
  seenRequest?: CompletionRequest;
  seenAuth?: ProviderAuth;
  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    this.seenRequest = request;
    this.seenAuth = auth;
    return this.response;
  }
}

class FakeCreds implements CredentialsResolver {
  async resolve(): Promise<ProviderAuth> {
    return { apiKey: "test-key", baseUrl: "https://example.test" };
  }
}

function makeInput(overrides: Partial<StepInput> = {}): StepInput {
  return {
    agentName: "a",
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
