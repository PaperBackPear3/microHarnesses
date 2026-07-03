import {
  type CompletionRequest,
  type ProviderAdapter,
  type ProviderAuth,
  ProviderError,
  type ProviderResponse,
  type ProviderStreamEvent,
} from "@micro-harness/core";
import { parseToolCallArgs } from "./openaiCompat";
import { readSseData } from "./sse";

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AnthropicStreamPayload {
  type?: string;
  index?: number;
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  content_block?: {
    type?: string;
    text?: string;
    thinking?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface ToolUseAccumulator {
  name: string;
  inputObject?: Record<string, unknown>;
  inputJson: string;
}

export interface AnthropicAdapterOptions {
  fetchImpl?: typeof fetch;
  defaultModel?: string;
}

const DEFAULT_MODEL = "claude-3-5-sonnet-latest";

export class AnthropicAdapter implements ProviderAdapter {
  readonly providerId = "anthropic" as const;
  readonly defaultModel: string;
  readonly features = { structuredTools: true } as const;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  }

  async *streamComplete(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent> {
    const endpoint = `${auth.baseUrl ?? "https://api.anthropic.com/v1"}/messages`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": auth.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ ...toAnthropicBody(request), stream: true }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`Anthropic error (${response.status}): ${errorBody}`);
    }

    let assistantMessage = "";
    let reasoningMessage = "";
    let stopReason = "";
    const usage: { inputTokens?: number; outputTokens?: number } = {};
    const toolUses = new Map<number, ToolUseAccumulator>();

    for await (const data of readSseData(response)) {
      const payload = JSON.parse(data) as AnthropicStreamPayload;
      if (payload.type === "message_start") {
        usage.inputTokens = payload.message?.usage?.input_tokens;
        continue;
      }
      if (payload.type === "content_block_start") {
        const index = payload.index ?? toolUses.size;
        if (payload.content_block?.type === "text") {
          const initial = payload.content_block.text ?? "";
          if (initial.length > 0) {
            assistantMessage += initial;
            yield { type: "assistant.delta", delta: initial };
          }
          continue;
        }
        if (payload.content_block?.type === "thinking") {
          const initial = payload.content_block.thinking ?? payload.content_block.text ?? "";
          if (initial.length > 0) {
            reasoningMessage += initial;
            yield { type: "reasoning.delta", delta: initial };
          }
          continue;
        }
        if (payload.content_block?.type === "tool_use") {
          toolUses.set(index, {
            name: payload.content_block.name ?? "unknown",
            inputObject: payload.content_block.input,
            inputJson: "",
          });
        }
        continue;
      }
      if (payload.type === "content_block_delta") {
        const index = payload.index ?? 0;
        if (payload.delta?.type === "text_delta") {
          const text = payload.delta.text ?? "";
          if (text.length > 0) {
            assistantMessage += text;
            yield { type: "assistant.delta", delta: text };
          }
          continue;
        }
        if (payload.delta?.type === "thinking_delta") {
          const text = payload.delta.thinking ?? payload.delta.text ?? "";
          if (text.length > 0) {
            reasoningMessage += text;
            yield { type: "reasoning.delta", delta: text };
          }
          continue;
        }
        if (payload.delta?.type === "input_json_delta") {
          const tool = toolUses.get(index) ?? { name: "unknown", inputJson: "" };
          tool.inputJson += payload.delta.partial_json ?? "";
          toolUses.set(index, tool);
        }
        continue;
      }
      if (payload.type === "message_delta") {
        usage.outputTokens = payload.usage?.output_tokens;
        if (payload.delta?.stop_reason) {
          stopReason = payload.delta.stop_reason;
        }
      }
    }

    const toolCalls = Array.from(toolUses.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, tool]) => {
        if (tool.inputJson.length === 0 && tool.inputObject) {
          return { name: tool.name, input: tool.inputObject };
        }
        const rawJson =
          tool.inputJson.length > 0
            ? tool.inputJson
            : tool.inputObject
              ? JSON.stringify(tool.inputObject)
              : "{}";
        const parsed = parseToolCallArgs(rawJson);
        return {
          name: tool.name,
          input: parsed.input,
          ...(parsed.malformed ? { malformedInput: true } : {}),
        };
      });

    yield {
      type: "final",
      response: {
        assistantMessage,
        ...(reasoningMessage.length > 0 ? { reasoningMessage } : {}),
        toolCalls,
        stop: stopReason === "end_turn",
        usage,
      },
    };
  }

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    const endpoint = `${auth.baseUrl ?? "https://api.anthropic.com/v1"}/messages`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": auth.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(toAnthropicBody(request)),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`Anthropic error (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as AnthropicResponse;
    const reasoningMessage =
      payload.content
        ?.filter((item) => item.type === "thinking")
        .map((item) => item.text ?? "")
        .join("") ?? "";
    return {
      assistantMessage:
        payload.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("") ?? "",
      ...(reasoningMessage.length > 0 ? { reasoningMessage } : {}),
      toolCalls:
        payload.content
          ?.filter((item) => item.type === "tool_use")
          .map((item) => ({
            name: item.name ?? "unknown",
            input: item.input ?? {},
          })) ?? [],
      stop: payload.stop_reason === "end_turn",
      usage: {
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
      },
    };
  }
}

function toAnthropicBody(request: CompletionRequest): Record<string, unknown> {
  const systemMessage = request.messages
    .filter((m) => m.role === "system" || m.role === "developer")
    .map((m) => m.content)
    .join("\n\n");
  const messages = request.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: m.content,
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
          })),
        }
      : {}),
  };
}
