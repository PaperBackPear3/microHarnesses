import type {
  CompletionRequest,
  ProviderAdapter,
  ProviderAuth,
  ProviderResponse,
  ProviderStreamEvent,
} from "../../providers/types";
import { ProviderError } from "../../shared/errors";
import {
  type OpenAICompatResponse,
  type OpenAICompatStreamChunk,
  applyOpenAICompatStreamChunk,
  createOpenAICompatStreamState,
  finalizeOpenAICompatStream,
  parseOpenAICompatResponse,
} from "./openaiCompat";
import { readSseData } from "./sse";

export interface OllamaAdapterOptions {
  fetchImpl?: typeof fetch;
  defaultModel?: string;
}

const DEFAULT_MODEL = "llama3.2:3b";

export class OllamaAdapter implements ProviderAdapter {
  readonly providerId = "ollama" as const;
  readonly defaultModel: string;
  readonly features = { structuredTools: true } as const;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaAdapterOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  }

  async *streamComplete(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent> {
    const endpoint = `${auth.baseUrl ?? "http://127.0.0.1:11434/v1"}/chat/completions`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...toOllamaBody(request), stream: true }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ProviderError(`Ollama error (${response.status}): ${errorBody}`);
    }

    const state = createOpenAICompatStreamState();
    for await (const data of readSseData(response)) {
      if (data === "[DONE]") break;
      const payload = JSON.parse(data) as OpenAICompatStreamChunk;
      const deltas = applyOpenAICompatStreamChunk(state, payload);
      if (deltas.reasoningDelta.length > 0) {
        yield { type: "reasoning.delta", delta: deltas.reasoningDelta };
      }
      if (deltas.assistantDelta.length > 0) {
        yield { type: "assistant.delta", delta: deltas.assistantDelta };
      }
    }
    yield { type: "final", response: finalizeOpenAICompatStream(state) };
  }

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    const endpoint = `${auth.baseUrl ?? "http://127.0.0.1:11434/v1"}/chat/completions`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...toOllamaBody(request), stream: false }),
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

function toOllamaBody(request: CompletionRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role === "developer" ? "system" : m.role,
      content: m.content,
    })),
    ...(request.tools && request.tools.length > 0
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxTokens ?? 4096,
  };
}
