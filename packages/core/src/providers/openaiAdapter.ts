import { ProviderError } from "../errors";
import { CompletionRequest, ProviderAdapter, ProviderAuth, ProviderResponse } from "../types";

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: string; text?: string }>;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

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

    const payload = (await response.json()) as OpenAIResponse;
    const first = payload.choices?.[0];
    if (!first?.message) {
      throw new ProviderError("OpenAI returned no message");
    }

    return {
      assistantMessage: contentToText(first.message.content),
      toolCalls: (first.message.tool_calls ?? [])
        .map((call) => {
          const rawArgs = call.function?.arguments ?? "{}";
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(rawArgs) as Record<string, unknown>;
          } catch {
            parsed = { raw: rawArgs };
          }
          return {
            name: call.function?.name ?? "unknown",
            input: parsed
          };
        }),
      stop: first.finish_reason === "stop",
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens
      }
    };
  }
}

function contentToText(content: string | Array<{ type: string; text?: string }> | undefined): string {
  if (!content) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}
