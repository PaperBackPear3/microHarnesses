import { ProviderError } from "../shared/errors";
import { type OpenAICompatResponse, parseOpenAICompatResponse } from "./openaiCompat";
import type { CompletionRequest, ProviderAdapter, ProviderAuth, ProviderResponse } from "./types";

export interface OpenAIAdapterOptions {
  fetchImpl?: typeof fetch;
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerId = "openai" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
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
