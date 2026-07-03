import { ProviderError } from "../errors";
import { CompletionRequest, ProviderAdapter, ProviderAuth, ProviderResponse } from "../types";
import { OpenAICompatResponse, parseOpenAICompatResponse } from "./openaiCompat";

export class OpenAIAdapter implements ProviderAdapter {
  readonly providerId = "openai" as const;

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    const endpoint = `${auth.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth.apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 800
      })
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
