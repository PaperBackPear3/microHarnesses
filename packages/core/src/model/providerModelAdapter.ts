import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { CompletionRequest, ProviderId, ProviderMessage } from "../providers/types";
import { ConfigError } from "../shared/errors";
import type { ModelAdapter, StepInput, StepPlan } from "./types";

export interface ProviderModelAdapterOptions {
  providerRegistry: ProviderRegistry;
  credentialsRegistry: CredentialsRegistry;
  providerId: ProviderId;
  model?: string;
  maxTokens?: number;
}

export class ProviderModelAdapter implements ModelAdapter {
  private readonly providerRegistry: ProviderRegistry;
  private readonly credentialsRegistry: CredentialsRegistry;
  private readonly providerId: ProviderId;
  private readonly model?: string;
  private readonly maxTokens: number;

  constructor(options: ProviderModelAdapterOptions) {
    this.providerRegistry = options.providerRegistry;
    this.credentialsRegistry = options.credentialsRegistry;
    this.providerId = options.providerId;
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 1000;
  }

  async nextStep(input: StepInput): Promise<StepPlan> {
    const adapter = this.providerRegistry.get(this.providerId);
    const resolvedModel = input.selectedModel ?? this.model ?? adapter.defaultModel;
    if (!resolvedModel) {
      throw new ConfigError(
        `No model specified and provider "${this.providerId}" declares no defaultModel`,
      );
    }
    const auth = await this.credentialsRegistry.get(this.providerId).resolve();
    const request: CompletionRequest = {
      model: resolvedModel,
      messages: buildMessages(input),
      maxTokens: this.maxTokens,
    };

    const response = await adapter.complete(request, auth);
    return {
      assistantMessage: response.assistantMessage,
      toolCalls: response.toolCalls.map((t) => ({
        name: t.name,
        input: t.input,
        ...(t.malformedInput ? { malformedInput: true } : {}),
      })),
      stop: response.stop,
      usage: response.usage,
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
