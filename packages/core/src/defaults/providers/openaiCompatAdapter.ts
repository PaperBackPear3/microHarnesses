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
import { createOpenAICompatibleTokenCounter } from "./tokenCounter";

export interface OpenAICompatAdapterOptions {
  /** Registry id for this provider (e.g. "openrouter", "groq", "azure-openai"). */
  providerId: string;
  /** Model used when the composition root does not specify one. */
  defaultModel: string;
  /** Base URL used when credentials do not supply one (e.g. "https://api.groq.com/openai/v1"). */
  defaultBaseUrl?: string;
  /**
   * How the resolved API key is sent. `"bearer"` adds an
   * `authorization: Bearer <key>` header; `"none"` sends no auth header
   * (local servers such as Ollama / LM Studio). Default: `"bearer"`.
   */
  authStyle?: "bearer" | "none";
  /** Extra headers merged into every request (e.g. OpenRouter attribution headers). */
  extraHeaders?: Record<string, string>;
  /**
   * Rewrite `developer` role messages to `system` for servers that only accept
   * the classic role set. Default: `true` (safest for third-party endpoints);
   * the OpenAI preset disables it.
   */
  mapDeveloperRoleToSystem?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Generic adapter for any OpenAI-compatible `/chat/completions` endpoint
 * (OpenRouter, Groq, Azure OpenAI with baseUrl, LM Studio, vLLM, …).
 * The built-in OpenAI and Ollama adapters are thin presets of this class.
 */
export class OpenAICompatAdapter implements ProviderAdapter {
  readonly providerId: string;
  readonly defaultModel: string;
  readonly features = { structuredTools: true } as const;
  private readonly defaultBaseUrl?: string;
  private readonly authStyle: "bearer" | "none";
  private readonly extraHeaders: Record<string, string>;
  private readonly mapDeveloperRoleToSystem: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatAdapterOptions) {
    this.providerId = options.providerId;
    this.defaultModel = options.defaultModel;
    this.defaultBaseUrl = options.defaultBaseUrl;
    this.authStyle = options.authStyle ?? "bearer";
    this.extraHeaders = options.extraHeaders ?? {};
    this.mapDeveloperRoleToSystem = options.mapDeveloperRoleToSystem ?? true;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async *streamComplete(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent> {
    const response = await this.fetchImpl(this.endpoint(auth), {
      method: "POST",
      headers: this.headers(auth),
      body: JSON.stringify({
        ...this.toBody(request),
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: request.signal,
    });
    await this.ensureOk(response);

    const state = createOpenAICompatStreamState();
    for await (const data of readSseData(response)) {
      if (data === "[DONE]") break;
      const payload = this.parseStreamChunk(data);
      if (!payload) continue;
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
    const response = await this.fetchImpl(this.endpoint(auth), {
      method: "POST",
      headers: this.headers(auth),
      body: JSON.stringify({ ...this.toBody(request), stream: false }),
      signal: request.signal,
    });
    await this.ensureOk(response);

    const payload = (await response.json()) as OpenAICompatResponse;
    const parsed = parseOpenAICompatResponse(payload);
    if (!parsed) {
      throw new ProviderError(`${this.label()} returned no message`);
    }
    return parsed;
  }

  async createTokenCounter(model: string) {
    return createOpenAICompatibleTokenCounter(model);
  }

  private endpoint(auth: ProviderAuth): string {
    const baseUrl = auth.baseUrl ?? this.defaultBaseUrl;
    if (!baseUrl) {
      throw new ProviderError(
        `${this.label()}: no base URL configured (set credentials baseUrl or defaultBaseUrl)`,
      );
    }
    return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  private headers(auth: ProviderAuth): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.extraHeaders,
    };
    if (this.authStyle === "bearer") {
      headers.authorization = `Bearer ${auth.apiKey}`;
    }
    return headers;
  }

  private async ensureOk(response: Response): Promise<void> {
    if (response.ok) return;
    const errorBody = await response.text();
    throw new ProviderError(`${this.label()} error (${response.status}): ${errorBody}`);
  }

  private parseStreamChunk(data: string): OpenAICompatStreamChunk | undefined {
    try {
      return JSON.parse(data) as OpenAICompatStreamChunk;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError(`${this.label()} sent a malformed stream frame: ${message}`);
    }
  }

  private label(): string {
    return `Provider "${this.providerId}"`;
  }

  private toBody(request: CompletionRequest): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: this.mapDeveloperRoleToSystem && m.role === "developer" ? "system" : m.role,
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
}
