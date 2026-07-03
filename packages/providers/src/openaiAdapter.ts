import {
  type CompletionRequest,
  type ProviderAdapter,
  type ProviderAuth,
  ProviderError,
  type ProviderResponse,
  type ProviderStreamEvent,
} from "@micro-harness/core";
import {
  type OpenAICompatResponse,
  type OpenAICompatStreamChunk,
  applyOpenAICompatStreamChunk,
  createOpenAICompatStreamState,
  finalizeOpenAICompatStream,
  parseOpenAICompatResponse,
} from "./openaiCompat";
import { readSseData } from "./sse";

export interface OpenAIAdapterOptions {
  fetchImpl?: typeof fetch;
  defaultModel?: string;
}

const DEFAULT_MODEL = "gpt-4.1-mini";

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerId = "openai" as const;
  readonly defaultModel: string;
  readonly features = { structuredTools: true } as const;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  }

  async *streamComplete(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent> {
    const endpoint = `${auth.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth.apiKey}`,
      },
      body: JSON.stringify({
        ...toOpenAIBody(request),
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`OpenAI error (${response.status}): ${errorBody}`);
    }

    const state = createOpenAICompatStreamState();
    for await (const data of readSseData(response)) {
      if (data === "[DONE]") {
        break;
      }
      const payload = JSON.parse(data) as OpenAICompatStreamChunk;
      const delta = applyOpenAICompatStreamChunk(state, payload);
      if (delta.length > 0) {
        yield { type: "assistant.delta", delta };
      }
    }

    yield { type: "final", response: finalizeOpenAICompatStream(state) };
  }

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    const endpoint = `${auth.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth.apiKey}`,
      },
      body: JSON.stringify(toOpenAIBody(request)),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`OpenAI error (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as OpenAICompatResponse;
    const parsed = parseOpenAICompatResponse(payload);
    if (!parsed) {
      throw new ProviderError("OpenAI returned no message");
    }
    return parsed;
  }
}

function toOpenAIBody(request: CompletionRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxTokens ?? 800,
  };
}
