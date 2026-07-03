/** Shared utilities for OpenAI-compatible provider adapters. */

export function contentToText(
  content: string | Array<{ type: string; text?: string }> | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

export interface ParsedToolCallArgs {
  input: Record<string, unknown>;
  malformed: boolean;
}

export function parseToolCallArgs(rawArgs: string): ParsedToolCallArgs {
  try {
    return { input: JSON.parse(rawArgs) as Record<string, unknown>, malformed: false };
  } catch {
    return { input: { raw: rawArgs }, malformed: true };
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
    toolCalls: (first.message.tool_calls ?? []).map((call) => {
      const parsed = parseToolCallArgs(call.function?.arguments ?? "{}");
      return {
        name: call.function?.name ?? "unknown",
        input: parsed.input,
        ...(parsed.malformed ? { malformedInput: true } : {}),
      };
    }),
    stop: first.finish_reason === "stop",
    usage: {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
    },
  };
}
