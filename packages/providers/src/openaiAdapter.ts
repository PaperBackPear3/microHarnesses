import {
  type CompletionRequest,
  type ProviderAdapter,
  type ProviderAuth,
  ProviderError,
  type ProviderResponse,
} from "@micro-harness/core";
import { type OpenAICompatResponse, parseOpenAICompatResponse } from "./openaiCompat";

export interface OpenAIAdapterOptions {
  fetchImpl?: typeof fetch;
  defaultModel?: string;
}

const DEFAULT_MODEL = "gpt-4.1-mini";

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerId = "openai" as const;
  readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  }

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    const endpoint = `${auth.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 800,
      }),
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
