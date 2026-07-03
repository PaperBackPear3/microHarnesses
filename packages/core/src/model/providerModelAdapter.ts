import { ProviderRegistry } from "../providers/registry";
import {
  CompletionRequest,
  ModelAdapter,
  ProviderCredentialsResolver,
  ProviderId,
  ProviderMessage,
  StepInput,
  StepPlan
} from "../types";

export interface ProviderModelAdapterOptions {
  providerRegistry: ProviderRegistry;
  credentialsResolver: ProviderCredentialsResolver;
  providerId: ProviderId;
  model: string;
}

export class ProviderModelAdapter implements ModelAdapter {
  private readonly providerRegistry: ProviderRegistry;
  private readonly credentialsResolver: ProviderCredentialsResolver;
  private readonly providerId: ProviderId;
  private readonly model: string;

  constructor(options: ProviderModelAdapterOptions) {
    this.providerRegistry = options.providerRegistry;
    this.credentialsResolver = options.credentialsResolver;
    this.providerId = options.providerId;
    this.model = options.model;
  }

  async nextStep(input: StepInput): Promise<StepPlan> {
    const resolvedModel = input.selectedModel ?? this.model;
    const auth = await this.credentialsResolver.resolve(this.providerId);
    const adapter = this.providerRegistry.get(this.providerId);
    const request: CompletionRequest = {
      model: resolvedModel,
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
  const systemParts = [input.bundle.system];
  for (const instruction of input.bundle.instructions) {
    if (instruction.role === "tools" || instruction.role === "custom") {
      systemParts.push(`# ${instruction.name}\n${instruction.content}`);
    }
  }

  const messages: ProviderMessage[] = [{ role: "system", content: systemParts.join("\n\n") }];
  for (const instruction of input.bundle.instructions) {
    if (instruction.role === "developer") {
      messages.push({ role: "developer", content: instruction.content });
    }
  }
  for (const turn of input.workingTurns) {
    messages.push({ role: "user", content: turn.userMessage });
    messages.push({ role: "assistant", content: turn.assistantMessage });
  }

  messages.push({ role: "user", content: input.bundle.task });
  return messages;
}
