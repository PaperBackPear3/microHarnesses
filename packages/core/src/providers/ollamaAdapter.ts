import { ProviderError } from "../errors";
import { CompletionRequest, ProviderAdapter, ProviderAuth, ProviderResponse } from "../types";
import { OpenAICompatResponse, parseOpenAICompatResponse } from "./openaiCompat";

export class OllamaAdapter implements ProviderAdapter {
  readonly providerId = "ollama" as const;

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    const endpoint = `${auth.baseUrl ?? "http://127.0.0.1:11434/v1"}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        // Ollama does not support the "developer" role — fold it into "system"
        messages: request.messages.map((m) => ({
          role: m.role === "developer" ? "system" : m.role,
          content: m.content
        })),
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 800,
        stream: false
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`Ollama error (${response.status}): ${errorBody}`);
    }

    const payload = (await response.json()) as OpenAICompatResponse;
    const parsed = parseOpenAICompatResponse(payload);
    if (!parsed) {
      throw new ProviderError("Ollama returned no message");
    }
    return parsed;
  }
}
