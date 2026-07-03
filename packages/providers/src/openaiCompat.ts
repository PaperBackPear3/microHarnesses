/** Shared utilities for OpenAI-compatible provider adapters. */

type OpenAICompatContentPart = { type?: string; text?: string };

export function contentToText(content: string | OpenAICompatContentPart[] | undefined): string {
  return splitContent(content).assistant;
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
      content?: string | OpenAICompatContentPart[];
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
      content?: string | OpenAICompatContentPart[];
      reasoning?: string | OpenAICompatContentPart[];
      reasoning_content?: string | OpenAICompatContentPart[];
      thinking?: string;
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
  reasoningMessage: string;
  toolCalls: Map<number, ToolCallBuffer>;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
  };
  stop: boolean;
}

export interface OpenAICompatStreamDelta {
  assistantDelta: string;
  reasoningDelta: string;
}

export function createOpenAICompatStreamState(): OpenAICompatStreamState {
  return {
    assistantMessage: "",
    reasoningMessage: "",
    toolCalls: new Map<number, ToolCallBuffer>(),
    usage: {},
    stop: false,
  };
}

export function applyOpenAICompatStreamChunk(
  state: OpenAICompatStreamState,
  payload: OpenAICompatStreamChunk,
): OpenAICompatStreamDelta {
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
    return { assistantDelta: "", reasoningDelta: "" };
  }

  const { assistantDelta, reasoningDelta } = splitStreamDelta(choice.delta);
  if (assistantDelta.length > 0) {
    state.assistantMessage += assistantDelta;
  }
  if (reasoningDelta.length > 0) {
    state.reasoningMessage += reasoningDelta;
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
  return { assistantDelta, reasoningDelta };
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
    ...(state.reasoningMessage.length > 0 ? { reasoningMessage: state.reasoningMessage } : {}),
    toolCalls,
    stop: state.stop,
    usage: state.usage,
  };
}

export function parseOpenAICompatResponse(payload: OpenAICompatResponse) {
  const first = payload.choices?.[0];
  if (!first?.message) return null;
  const split = splitContent(first.message.content);
  return {
    assistantMessage: split.assistant,
    ...(split.reasoning.length > 0 ? { reasoningMessage: split.reasoning } : {}),
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

function splitStreamDelta(
  delta: NonNullable<OpenAICompatStreamChunk["choices"]>[number]["delta"],
): {
  assistantDelta: string;
  reasoningDelta: string;
} {
  if (!delta) {
    return { assistantDelta: "", reasoningDelta: "" };
  }
  const contentSplit = splitContent(delta.content);
  const reasoningFromReasoning = splitContent(delta.reasoning).reasoning;
  const reasoningFromReasoningContent = splitContent(delta.reasoning_content).reasoning;
  const thinking = delta.thinking ?? "";

  return {
    assistantDelta: contentSplit.assistant,
    reasoningDelta:
      contentSplit.reasoning + reasoningFromReasoning + reasoningFromReasoningContent + thinking,
  };
}

function splitContent(content: string | OpenAICompatContentPart[] | undefined): {
  assistant: string;
  reasoning: string;
} {
  if (!content) return { assistant: "", reasoning: "" };
  if (typeof content === "string") return { assistant: content, reasoning: "" };
  let assistant = "";
  let reasoning = "";
  for (const part of content) {
    const text = part.text ?? "";
    if (text.length === 0) continue;
    const kind = (part.type ?? "").toLowerCase();
    if (kind.includes("reason") || kind.includes("thinking")) {
      reasoning += text;
      continue;
    }
    assistant += text;
  }
  return { assistant, reasoning };
}
