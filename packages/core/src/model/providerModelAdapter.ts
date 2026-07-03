import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { CompletionRequest, ProviderId, ProviderMessage } from "../providers/types";
import { ConfigError } from "../shared/errors";
import { truncate } from "../shared/text";
import type { ToolDescriptor } from "../tools/types";
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
    const supportsStructuredTools = adapter.features?.structuredTools === true;
    const resolvedModel = input.selectedModel ?? this.model ?? adapter.defaultModel;
    if (!resolvedModel) {
      throw new ConfigError(
        `No model specified and provider "${this.providerId}" declares no defaultModel`,
      );
    }
    const auth = await this.credentialsRegistry.get(this.providerId).resolve();
    const request: CompletionRequest = {
      model: resolvedModel,
      messages: buildMessages(input, !supportsStructuredTools),
      maxTokens: this.maxTokens,
      tools: input.availableTools,
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

function buildMessages(input: StepInput, includeToolCatalogFallback: boolean): ProviderMessage[] {
  const systemParts = [input.bundle.system];
  for (const instruction of input.bundle.instructions) {
    if (instruction.role === "tools" || instruction.role === "custom") {
      systemParts.push(`# ${instruction.name}\n${instruction.content}`);
    }
  }
  if (includeToolCatalogFallback && (input.availableTools?.length ?? 0) > 0) {
    systemParts.push(renderToolCatalogInstruction(input.availableTools ?? []));
  }

  const messages: ProviderMessage[] = [{ role: "system", content: systemParts.join("\n\n") }];
  for (const instruction of input.bundle.instructions) {
    if (instruction.role === "developer") {
      messages.push({ role: "developer", content: instruction.content });
    }
  }
  for (const turn of input.workingTurns) {
    messages.push({ role: "user", content: turn.userMessage });
    if (turn.assistantMessage.trim().length > 0) {
      messages.push({ role: "assistant", content: turn.assistantMessage });
    }
    if (turn.toolCalls.length > 0 || turn.toolResults.length > 0) {
      messages.push({
        role: "user",
        content: renderToolResultFeedback(turn.toolCalls, turn.toolResults),
      });
    }
  }

  const lastUserMessage = input.workingTurns[input.workingTurns.length - 1]?.userMessage;
  if (lastUserMessage !== input.bundle.task) {
    messages.push({ role: "user", content: input.bundle.task });
  }
  return messages;
}

function renderToolCatalogInstruction(tools: ToolDescriptor[]): string {
  const entries = tools
    .map((tool) => {
      const schema = JSON.stringify(tool.inputSchema);
      return `- ${tool.name}: ${tool.description}\n  input schema: ${schema}`;
    })
    .join("\n");

  return [
    "## Runtime tool catalog (authoritative)",
    "If you need a tool, call it by exact name from the list below.",
    "Do not append parentheses to tool names (use `time`, not `time()`).",
    "Available tools:",
    entries,
  ].join("\n");
}

function renderToolResultFeedback(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  results: Array<{ ok: boolean; output: Record<string, unknown>; error?: string }>,
): string {
  const callLines = calls.map((call, index) => {
    const input = truncate(JSON.stringify(call.input), 300);
    return `${index + 1}. ${call.name} input=${input}`;
  });
  const resultLines = results.map((result, index) => {
    if (!result.ok) {
      return `${index + 1}. error=${result.error ?? "unknown error"}`;
    }
    return `${index + 1}. output=${truncate(JSON.stringify(result.output), 500)}`;
  });
  return [
    "Tool execution feedback from the previous step:",
    "Tool calls:",
    ...(callLines.length > 0 ? callLines : ["(none)"]),
    "Tool results:",
    ...(resultLines.length > 0 ? resultLines : ["(none)"]),
    "Use this feedback to decide the next action. If the request is satisfied, return the final answer.",
  ].join("\n");
}
