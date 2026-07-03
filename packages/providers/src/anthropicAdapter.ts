import {
  type CompletionRequest,
  type ProviderAdapter,
  type ProviderAuth,
  ProviderError,
  type ProviderResponse,
} from "@micro-harness/core";

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
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

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    const endpoint = `${auth.baseUrl ?? "https://api.anthropic.com/v1"}/messages`;
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

    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": auth.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? 800,
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
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`Anthropic error (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as AnthropicResponse;
    return {
      assistantMessage:
        payload.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("") ?? "",
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
