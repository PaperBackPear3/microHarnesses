import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  Message,
  MessageCreateParamsBase,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import type {
  CompletionRequest,
  ProviderAdapter,
  ProviderAuth,
  ProviderContentPart,
  ProviderModelInfo,
  ProviderResponse,
  ProviderStreamEvent,
} from "../../providers/types";
import { ProviderError } from "../../shared/errors";

export interface AnthropicAdapterOptions {
  fetchImpl?: typeof fetch;
  defaultModel?: string;
}

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

/**
 * Maps an Anthropic `stop_reason` to loop-stop semantics: terminal reasons
 * (`end_turn`, `stop_sequence`, `refusal`) stop the loop, while `tool_use` and
 * `max_tokens` continue so truncated generations can finish next iteration.
 */
function stopReasonIndicatesStop(reason: string | undefined | null): boolean {
  if (!reason) return false;
  return reason !== "tool_use" && reason !== "max_tokens";
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerId = "anthropic" as const;
  readonly defaultModel: string;
  readonly features = {
    structuredTools: true,
    inputParts: { text: true, image: true, file: true, inlineBinary: true },
  } as const;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  }

  async *streamComplete(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent> {
    try {
      const client = this.createClient(auth);
      const stream = client.messages.stream(
        {
          ...(this.toRequestBody(request) as MessageCreateParamsBase),
          stream: true,
        } as MessageCreateParamsStreaming,
        {
          signal: request.signal,
        },
      );
      const finalMessagePromise = stream.finalMessage();

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          yield* this.emitStartDelta(event.content_block);
          continue;
        }
        if (event.type === "content_block_delta") {
          yield* this.emitDelta(event.delta);
        }
      }

      yield { type: "final", response: this.toProviderResponse(await finalMessagePromise) };
    } catch (error: unknown) {
      throw this.asProviderError(error);
    }
  }

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    try {
      const client = this.createClient(auth);
      const response = await client.messages.create(
        {
          ...(this.toRequestBody(request) as MessageCreateParamsBase),
          stream: false,
        } as MessageCreateParamsNonStreaming,
        {
          signal: request.signal,
        },
      );
      return this.toProviderResponse(response);
    } catch (error: unknown) {
      throw this.asProviderError(error);
    }
  }

  /**
   * Lists models via the Anthropic Models API. Callers should treat a thrown
   * error as "discovery unavailable" and fall back to static routes.
   *
   * Anthropic's model list response includes real `max_input_tokens` (unlike
   * OpenAI's, which only returns id/created/object/owned_by) — surfaced here
   * as `contextWindowTokens` so it doesn't have to come from the manually
   * maintained catalog. Pricing is still not exposed by any provider API.
   */
  async listModels(auth: ProviderAuth): Promise<ProviderModelInfo[]> {
    try {
      const client = this.createClient(auth);
      const page = await client.models.list();
      const models: ProviderModelInfo[] = [];
      for await (const model of page) {
        models.push({
          id: model.id,
          label: model.display_name,
          ...(model.max_input_tokens ? { contextWindowTokens: model.max_input_tokens } : {}),
        });
      }
      return models;
    } catch (error: unknown) {
      throw this.asProviderError(error);
    }
  }

  private createClient(auth: ProviderAuth): Anthropic {
    return new Anthropic({
      apiKey: auth.apiKey,
      baseURL: auth.baseUrl ?? "https://api.anthropic.com/v1",
      fetch: this.fetchImpl,
    });
  }

  private toRequestBody(request: CompletionRequest): MessageCreateParamsBase {
    const systemMessage = request.messages
      .filter((m) => m.role === "system" || m.role === "developer")
      .map((m) => m.content)
      .join("\n\n");

    const messages: MessageParam[] = request.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: toAnthropicContent(m.content),
      }));

    return {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.2,
      system: systemMessage,
      messages,
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema,
            })) as Tool[],
          }
        : {}),
    };
  }

  private *emitStartDelta(block: ContentBlock): IterableIterator<ProviderStreamEvent> {
    if (block.type === "text" && block.text && block.text.length > 0) {
      yield { type: "assistant.delta", delta: block.text };
      return;
    }
    if (block.type === "thinking" && block.thinking && block.thinking.length > 0) {
      yield { type: "reasoning.delta", delta: block.thinking };
    }
  }

  private *emitDelta(delta: {
    type?: string;
    text?: string;
    thinking?: string;
  }): IterableIterator<ProviderStreamEvent> {
    if (delta.type === "text_delta" && delta.text && delta.text.length > 0) {
      yield { type: "assistant.delta", delta: delta.text };
      return;
    }
    if (delta.type === "thinking_delta" && delta.thinking && delta.thinking.length > 0) {
      yield { type: "reasoning.delta", delta: delta.thinking };
    }
  }

  private toProviderResponse(message: Message): ProviderResponse {
    const assistantMessage = this.contentText(message.content, "text");
    const reasoningMessage = this.contentText(message.content, "thinking");
    const toolCalls = message.content
      .filter((block): block is ToolUseBlock => block.type === "tool_use")
      .map((block) => {
        const input = block.input;
        if (input && typeof input === "object" && !Array.isArray(input)) {
          return { name: block.name, input: input as Record<string, unknown> };
        }
        const raw = typeof input === "string" ? input : JSON.stringify(input);
        try {
          return { name: block.name, input: JSON.parse(raw) as Record<string, unknown> };
        } catch {
          return { name: block.name, input: { raw }, malformedInput: true };
        }
      });

    return {
      assistantMessage,
      ...(reasoningMessage.length > 0 ? { reasoningMessage } : {}),
      toolCalls,
      stop: stopReasonIndicatesStop(message.stop_reason),
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  }

  private asProviderError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new ProviderError(`Provider "anthropic" error: ${message}`);
  }

  private contentText(blocks: ContentBlock[], type: "text" | "thinking"): string {
    return blocks
      .map((block) => {
        if (type === "text" && block.type === "text") {
          return block.text;
        }
        if (type === "thinking" && block.type === "thinking") {
          return block.thinking;
        }
        return "";
      })
      .join("");
  }
}

function toAnthropicContent(content: string | ProviderContentPart[]): MessageParam["content"] {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    if (part.type === "image") {
      const mediaType =
        part.mimeType === "image/jpeg" ||
        part.mimeType === "image/png" ||
        part.mimeType === "image/gif" ||
        part.mimeType === "image/webp"
          ? part.mimeType
          : "image/png";
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: part.dataBase64,
        },
      };
    }
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: part.mimeType,
        data: part.dataBase64,
      },
      title: part.title ?? part.filename,
    };
  }) as unknown as MessageParam["content"];
}
