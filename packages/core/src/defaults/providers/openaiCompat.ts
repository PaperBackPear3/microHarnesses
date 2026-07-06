type OpenAICompatContentPart = { type?: string; text?: string };

/**
 * Maps an OpenAI-compatible `finish_reason` to loop-stop semantics:
 * - `stop` / `length` / `content_filter` terminate generation → stop.
 * - `tool_calls` / `function_call` expect tool execution → continue.
 */
export function finishReasonIndicatesStop(reason: string | undefined): boolean {
  if (!reason) return false;
  return reason === "stop" || reason === "length" || reason === "content_filter";
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
      reasoning?: string | OpenAICompatContentPart[];
      reasoning_content?: string | OpenAICompatContentPart[];
      thinking?: string;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_eval_count?: number;
    eval_count?: number;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OpenAICompatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | OpenAICompatContentPart[];
      reasoning?: string | OpenAICompatContentPart[];
      reasoning_content?: string | OpenAICompatContentPart[];
      thinking?: string;
      tool_calls?: Array<{ index?: number; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_eval_count?: number;
    eval_count?: number;
  };
  prompt_eval_count?: number;
  eval_count?: number;
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
  const inputTokens =
    payload.usage?.prompt_tokens ?? payload.usage?.prompt_eval_count ?? payload.prompt_eval_count;
  const outputTokens =
    payload.usage?.completion_tokens ?? payload.usage?.eval_count ?? payload.eval_count;
  if (inputTokens !== undefined) {
    state.usage.inputTokens = inputTokens;
  }
  if (outputTokens !== undefined) {
    state.usage.outputTokens = outputTokens;
  }
  const choice = payload.choices?.[0];
  if (!choice?.delta) {
    if (finishReasonIndicatesStop(choice?.finish_reason)) {
      state.stop = true;
    }
    return { assistantDelta: "", reasoningDelta: "" };
  }
  const contentSplit = splitContent(choice.delta.content);
  const reasoningDelta =
    contentSplit.reasoning +
    reasoningFieldToText(choice.delta.reasoning) +
    reasoningFieldToText(choice.delta.reasoning_content) +
    (choice.delta.thinking ?? "");

  if (contentSplit.assistant.length > 0) {
    state.assistantMessage += contentSplit.assistant;
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

  if (finishReasonIndicatesStop(choice.finish_reason)) {
    state.stop = true;
  }

  return { assistantDelta: contentSplit.assistant, reasoningDelta };
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
  const reasoningMessage =
    split.reasoning +
    reasoningFieldToText(first.message.reasoning) +
    reasoningFieldToText(first.message.reasoning_content) +
    (first.message.thinking ?? "");
  return {
    assistantMessage: split.assistant,
    ...(reasoningMessage.length > 0 ? { reasoningMessage } : {}),
    toolCalls: (first.message.tool_calls ?? []).map((call) => {
      const parsed = parseToolCallArgs(call.function?.arguments ?? "{}");
      return {
        name: call.function?.name ?? "unknown",
        input: parsed.input,
        ...(parsed.malformed ? { malformedInput: true } : {}),
      };
    }),
    stop: finishReasonIndicatesStop(first.finish_reason),
    usage: {
      inputTokens:
        payload.usage?.prompt_tokens ??
        payload.usage?.prompt_eval_count ??
        payload.prompt_eval_count,
      outputTokens:
        payload.usage?.completion_tokens ?? payload.usage?.eval_count ?? payload.eval_count,
    },
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

function reasoningFieldToText(content: string | OpenAICompatContentPart[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  let text = "";
  for (const part of content) {
    text += part.text ?? "";
  }
  return text;
}
