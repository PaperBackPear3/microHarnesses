import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type {
  CompletionRequest,
  ProviderContentPart,
  ProviderId,
  ProviderMessage,
} from "../providers/types";
import type { InputAsset, MessageContentPart } from "../runtime/content";
import { ConfigError } from "../shared/errors";
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
    const providerId = (input.selectedProviderId as ProviderId | undefined) ?? current.providerId;
    const adapter = this.providerRegistry.get(providerId);
    const supportsStructuredTools = adapter.features?.structuredTools === true;
    assertTurnContentSupport(input.workingTurns, adapter.features?.inputParts, providerId);
    const resolvedModel = input.selectedModel ?? current.model ?? adapter.defaultModel;
    if (!resolvedModel) {
      throw new ConfigError(
        `No model specified and provider "${providerId}" declares no defaultModel`,
      );
    }
    const auth = await this.credentialsRegistry.get(providerId).resolve();
    const request: CompletionRequest = {
      model: resolvedModel,
      messages: await buildMessages(input, !supportsStructuredTools),
      maxTokens: input.selectedMaxTokens ?? current.maxTokens ?? 4096,
      tools: input.availableTools,
      signal: input.signal,
    };
    assertInputPartSupport(request.messages, adapter.features?.inputParts, providerId);

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
        throw new ConfigError(`Provider "${providerId}" stream did not emit a final response`);
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

async function buildMessages(
  input: StepInput,
  includeToolCatalogFallback: boolean,
): Promise<ProviderMessage[]> {
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
    const userContent = await mapTurnContentToProvider(turn.userContent, input.resolveInputAsset);
    if (userContent) {
      // When the resolved content has no text parts (e.g. image-only), prepend the
      // turn's text instruction so the model receives both instructions and media
      // in a single message instead of getting only the raw image with no context.
      const parts = Array.isArray(userContent)
        ? userContent
        : [{ type: "text" as const, text: String(userContent) }];
      const hasTextPart = parts.some((p) => p.type === "text");
      const combined =
        !hasTextPart && turn.userMessage.trim().length > 0
          ? [{ type: "text" as const, text: turn.userMessage }, ...parts]
          : parts;
      messages.push({ role: "user", content: combined });
    } else if (turn.userMessage.trim().length > 0) {
      messages.push({ role: "user", content: turn.userMessage });
    }
    const assistantContent = await mapTurnContentToProvider(
      turn.assistantContent,
      input.resolveInputAsset,
    );
    if (assistantContent) {
      messages.push({ role: "assistant", content: assistantContent });
    } else if (turn.assistantMessage.trim().length > 0) {
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

async function mapTurnContentToProvider(
  content: MessageContentPart[] | undefined,
  resolveInputAsset: StepInput["resolveInputAsset"],
): Promise<string | ProviderContentPart[] | undefined> {
  if (!content || content.length === 0) return undefined;
  if (content.every((part) => part.type === "text")) {
    return content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
  }

  const parts: ProviderContentPart[] = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    if (!resolveInputAsset) {
      throw new ConfigError(
        "Multimodal input requires an input asset resolver, but none is configured for this run",
      );
    }
    const asset = await resolveInputAsset(part.assetId);
    if (!asset) {
      throw new ConfigError(`Input asset "${part.assetId}" was not found for this session`);
    }
    const dataBase64 = await resolveAssetBase64(asset);
    if (part.type === "image") {
      parts.push({
        type: "image",
        mimeType: part.mimeType,
        dataBase64,
        filename: asset.filename,
        detail: part.detail,
        altText: part.altText,
      });
      continue;
    }
    parts.push({
      type: "file",
      mimeType: part.mimeType,
      dataBase64,
      filename: part.filename,
      title: part.title,
    });
  }
  return parts;
}

async function resolveAssetBase64(asset: InputAsset): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(asset.storagePath);
  return bytes.toString("base64");
}

function assertInputPartSupport(
  messages: ProviderMessage[],
  features: { text: boolean; image?: boolean; file?: boolean } | undefined,
  providerId: string,
): void {
  const inputParts = features ?? { text: true };
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "text" && inputParts.text !== false) continue;
      if (part.type === "image" && inputParts.image === true) continue;
      if (part.type === "file" && inputParts.file === true) continue;
      const kind = part.type;
      throw new ConfigError(
        `Provider "${providerId}" does not support ${kind} input parts for this model`,
      );
    }
  }
}

function assertTurnContentSupport(
  turns: StepInput["workingTurns"],
  features: { text: boolean; image?: boolean; file?: boolean } | undefined,
  providerId: string,
): void {
  const inputParts = features ?? { text: true };
  for (const turn of turns) {
    const parts = [...(turn.userContent ?? []), ...(turn.assistantContent ?? [])];
    for (const part of parts) {
      if (part.type === "text" && inputParts.text !== false) continue;
      if (part.type === "image" && inputParts.image === true) continue;
      if (part.type === "file" && inputParts.file === true) continue;
      throw new ConfigError(
        `Provider "${providerId}" does not support ${part.type} input parts for this model`,
      );
    }
  }
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
