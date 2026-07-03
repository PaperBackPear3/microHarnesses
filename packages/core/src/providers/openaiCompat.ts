/** Shared utilities for OpenAI-compatible provider adapters. */

export function contentToText(
  content: string | Array<{ type: string; text?: string }> | undefined
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

export function parseToolCallArgs(rawArgs: string): Record<string, unknown> {
  try {
    return JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    return { raw: rawArgs };
  }
}

export interface OpenAICompatResponse {
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

export function parseOpenAICompatResponse(payload: OpenAICompatResponse) {
  const first = payload.choices?.[0];
  if (!first?.message) return null;
  return {
    assistantMessage: contentToText(first.message.content),
    toolCalls: (first.message.tool_calls ?? []).map((call) => ({
      name: call.function?.name ?? "unknown",
      input: parseToolCallArgs(call.function?.arguments ?? "{}")
    })),
    stop: first.finish_reason === "stop",
    usage: {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens
    }
  };
}
