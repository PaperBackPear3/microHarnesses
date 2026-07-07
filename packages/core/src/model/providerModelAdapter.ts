import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { CompletionRequest, ProviderId, ProviderMessage } from "../providers/types";
import { ConfigError } from "../shared/errors";
import { truncate } from "../shared/text";
import { renderToolResultFeedback } from "../tools/resultFeedback";
import type { ToolDescriptor } from "../tools/types";
import type { ModelAdapter, StepInput, StepPlan } from "./types";

export interface ProviderModelSelection {
  providerId: ProviderId;
  model?: string;
  maxTokens?: number;
}

export interface ProviderModelAdapterOptions {
  providerRegistry: ProviderRegistry;
  credentialsRegistry: CredentialsRegistry;
  providerId?: ProviderId;
  model?: string;
  maxTokens?: number;
  /**
   * Optional dynamic selection, read on every step. When provided it takes
   * precedence over the static providerId/model/maxTokens options, letting a
   * long-lived adapter follow runtime provider/model switches.
   */
  selection?: () => ProviderModelSelection;
}

export class ProviderModelAdapter implements ModelAdapter {
  private readonly providerRegistry: ProviderRegistry;
  private readonly credentialsRegistry: CredentialsRegistry;
  private readonly staticSelection?: ProviderModelSelection;
  private readonly selection?: () => ProviderModelSelection;

  constructor(options: ProviderModelAdapterOptions) {
    this.providerRegistry = options.providerRegistry;
    this.credentialsRegistry = options.credentialsRegistry;
    this.selection = options.selection;
    if (options.providerId) {
      this.staticSelection = {
        providerId: options.providerId,
        model: options.model,
        maxTokens: options.maxTokens,
      };
    }
    if (!this.selection && !this.staticSelection) {
      throw new ConfigError("ProviderModelAdapter requires providerId or a selection getter");
    }
  }

  async nextStep(input: StepInput): Promise<StepPlan> {
    const current = this.selection?.() ?? (this.staticSelection as ProviderModelSelection);
    const adapter = this.providerRegistry.get(current.providerId);
    const supportsStructuredTools = adapter.features?.structuredTools === true;
    const resolvedModel = input.selectedModel ?? current.model ?? adapter.defaultModel;
    if (!resolvedModel) {
      throw new ConfigError(
        `No model specified and provider "${current.providerId}" declares no defaultModel`,
      );
    }
    const auth = await this.credentialsRegistry.get(current.providerId).resolve();
    const request: CompletionRequest = {
      model: resolvedModel,
      messages: buildMessages(input, !supportsStructuredTools),
      maxTokens: current.maxTokens ?? 4096,
      tools: input.availableTools,
      signal: input.signal,
    };

    if (adapter.streamComplete) {
      let finalResponse: Awaited<ReturnType<typeof adapter.complete>> | undefined;
      for await (const event of adapter.streamComplete(request, auth)) {
        if (event.type === "assistant.delta") {
          await input.onAssistantDelta?.(event.delta);
          continue;
        }
        if (event.type === "reasoning.delta") {
          await input.onReasoningDelta?.(event.delta);
          continue;
        }
        finalResponse = event.response;
      }
      if (!finalResponse) {
        throw new ConfigError(
          `Provider "${current.providerId}" stream did not emit a final response`,
        );
      }
      return toStepPlan(finalResponse);
    }

    const response = await adapter.complete(request, auth);
    if (response.reasoningMessage && response.reasoningMessage.length > 0) {
      await input.onReasoningDelta?.(response.reasoningMessage);
    }
    if (response.assistantMessage.length > 0) {
      await input.onAssistantDelta?.(response.assistantMessage);
    }
    return toStepPlan(response);
  }
}

function toStepPlan(response: {
  assistantMessage: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown>; malformedInput?: boolean }>;
  stop: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}): StepPlan {
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
  if (input.summary && input.summary.summary.trim().length > 0) {
    messages.push({
      role: "developer",
      content: renderSummaryInstruction(input.summary),
    });
  }
  if (input.workingTurns.length > 0) {
    messages.push({
      role: "developer",
      content:
        "Session history from prior turns is included below and is authoritative for this run. " +
        "When asked what was discussed before, summarize from the provided turns; do not claim " +
        "that prior discussion is unavailable.",
    });
  }
  for (const turn of input.workingTurns) {
    // Only turns that carry an actual user/task message emit a `user` message;
    // internal loop iterations leave it empty to avoid repeating the prompt.
    if (turn.userMessage.trim().length > 0) {
      messages.push({ role: "user", content: turn.userMessage });
    }
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

  const carriedTask = input.workingTurns.some((turn) => turn.userMessage === input.bundle.task);
  if (!carriedTask) {
    messages.push({ role: "user", content: input.bundle.task });
  }
  return messages;
}

function renderSummaryInstruction(summary: {
  summary: string;
  highlights: string[];
}): string {
  const lines = ["## Summary of earlier turns (authoritative prior context)", summary.summary];
  if (summary.highlights.length > 0) {
    lines.push("Highlights:", ...summary.highlights.map((h) => `- ${h}`));
  }
  return lines.join("\n");
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
