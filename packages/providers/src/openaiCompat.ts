/** Shared utilities for OpenAI-compatible provider adapters. */

export function contentToText(
  content: string | Array<{ type?: string; text?: string }> | undefined,
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

export interface OpenAICompatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: Array<{
        index?: number;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface ToolCallBuffer {
  name: string;
  args: string;
}

export interface OpenAICompatStreamState {
  assistantMessage: string;
  toolCalls: Map<number, ToolCallBuffer>;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
  };
  stop: boolean;
}

export function createOpenAICompatStreamState(): OpenAICompatStreamState {
  return {
    assistantMessage: "",
    toolCalls: new Map<number, ToolCallBuffer>(),
    usage: {},
    stop: false,
  };
}

export function applyOpenAICompatStreamChunk(
  state: OpenAICompatStreamState,
  payload: OpenAICompatStreamChunk,
): string {
  if (payload.usage?.prompt_tokens !== undefined) {
    state.usage.inputTokens = payload.usage.prompt_tokens;
  }
  if (payload.usage?.completion_tokens !== undefined) {
    state.usage.outputTokens = payload.usage.completion_tokens;
  }
  const choice = payload.choices?.[0];
  if (!choice?.delta) {
    if (choice?.finish_reason === "stop") {
      state.stop = true;
    }
    return "";
  }

  const text = contentToText(choice.delta.content);
  if (text.length > 0) {
    state.assistantMessage += text;
  }

  for (const [fallbackIndex, toolCall] of (choice.delta.tool_calls ?? []).entries()) {
    const index = toolCall.index ?? fallbackIndex;
    const current = state.toolCalls.get(index) ?? { name: "", args: "" };
    if (toolCall.function?.name) {
      current.name += toolCall.function.name;
    }
    if (toolCall.function?.arguments) {
      current.args += toolCall.function.arguments;
    }
    state.toolCalls.set(index, current);
  }

  if (choice.finish_reason === "stop") {
    state.stop = true;
  }
  return text;
}

export function finalizeOpenAICompatStream(state: OpenAICompatStreamState) {
  const toolCalls = Array.from(state.toolCalls.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, call]) => {
      const parsed = parseToolCallArgs(call.args || "{}");
      return {
        name: call.name || "unknown",
        input: parsed.input,
        ...(parsed.malformed ? { malformedInput: true } : {}),
      };
    });

  return {
    assistantMessage: state.assistantMessage,
    toolCalls,
    stop: state.stop,
    usage: state.usage,
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
