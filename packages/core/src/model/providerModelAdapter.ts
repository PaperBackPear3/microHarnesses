import { ProviderRegistry } from "../providers/registry";
import {
  CompletionRequest,
  ModelAdapter,
  ProviderCredentialsResolver,
  ProviderMessage,
  StepInput,
  StepPlan
} from "../types";

export interface ProviderModelAdapterOptions {
  providerRegistry: ProviderRegistry;
  credentialsResolver: ProviderCredentialsResolver;
  providerId: "openai" | "anthropic";
  model: string;
}

export class ProviderModelAdapter implements ModelAdapter {
  private readonly providerRegistry: ProviderRegistry;
  private readonly credentialsResolver: ProviderCredentialsResolver;
  private readonly providerId: "openai" | "anthropic";
  private readonly model: string;

  constructor(options: ProviderModelAdapterOptions) {
    this.providerRegistry = options.providerRegistry;
    this.credentialsResolver = options.credentialsResolver;
    this.providerId = options.providerId;
    this.model = options.model;
  }

  async nextStep(input: StepInput): Promise<StepPlan> {
    const auth = await this.credentialsResolver.resolve(this.providerId);
    const adapter = this.providerRegistry.get(this.providerId);
    const request: CompletionRequest = {
      model: input.selectedModel ?? this.model,
      messages: buildMessages(input),
      maxTokens: 1000
    };

    const response = await adapter.complete(request, auth);
    return {
      assistantMessage: response.assistantMessage,
      toolCalls: response.toolCalls.map((t) => ({ name: t.name, input: t.input })),
      stop: response.stop
    };
  }
}

function buildMessages(input: StepInput): ProviderMessage[] {
  const messages: ProviderMessage[] = [
    { role: "system" as const, content: input.bundle.system },
    { role: "user" as const, content: input.bundle.task }
  ];
  if (input.bundle.developer) {
    messages.push({ role: "developer", content: input.bundle.developer });
  }

  for (const turn of input.workingTurns) {
    messages.push({ role: "assistant", content: turn.assistantMessage });
  }
  return messages;
}
