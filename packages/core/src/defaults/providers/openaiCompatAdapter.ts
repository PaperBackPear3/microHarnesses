import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsBase,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions/completions";
import type {
  CompletionRequest,
  ProviderAdapter,
  ProviderAuth,
  ProviderContentPart,
  ProviderModelInfo,
  ProviderResponse,
  ProviderStreamEvent,
} from "../../providers/types";
import { ProviderError } from "../../shared/errors";
import {
  type OpenAICompatResponse,
  applyOpenAICompatStreamChunk,
  createOpenAICompatStreamState,
  finalizeOpenAICompatStream,
  parseOpenAICompatResponse,
} from "./openaiCompat";
import { createOpenAICompatibleTokenCounter } from "./tokenCounter";

export interface OpenAICompatAdapterOptions {
  /** Registry id for this provider (e.g. "openrouter", "groq", "azure-openai"). */
  providerId: string;
  /** Model used when the composition root does not specify one. */
  defaultModel: string;
  /** Base URL used when credentials do not supply one (e.g. "https://api.groq.com/openai/v1"). */
  defaultBaseUrl?: string;
  /**
   * How the resolved API key is sent. `"bearer"` adds the SDK auth header;
   * `"none"` strips it from the outgoing request (useful for local servers).
   * Default: `"bearer"`.
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
  /**
   * When `true`, adds `format: "json"` to every request body.
   * Ollama-compatible servers use this to enforce JSON output mode.
   */
  forceJsonMode?: boolean;
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
  readonly features = {
    structuredTools: true,
    inputParts: { text: true, image: true, file: false, inlineBinary: true },
  } as const;
  private readonly defaultBaseUrl?: string;
  private readonly authStyle: "bearer" | "none";
  private readonly extraHeaders: Record<string, string>;
  private readonly mapDeveloperRoleToSystem: boolean;
  private readonly forceJsonMode: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatAdapterOptions) {
    this.providerId = options.providerId;
    this.defaultModel = options.defaultModel;
    this.defaultBaseUrl = options.defaultBaseUrl;
    this.authStyle = options.authStyle ?? "bearer";
    this.extraHeaders = options.extraHeaders ?? {};
    this.mapDeveloperRoleToSystem = options.mapDeveloperRoleToSystem ?? true;
    this.forceJsonMode = options.forceJsonMode ?? false;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async *streamComplete(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent> {
    try {
      const client = this.createClient(auth);
      const body = {
        ...(this.toBody(request) as Record<string, unknown>),
        stream: true,
        stream_options: { include_usage: true },
      } as unknown as ChatCompletionCreateParamsStreaming;
      const stream = await client.chat.completions.create(body, { signal: request.signal });

      const state = createOpenAICompatStreamState();
      for await (const chunk of stream) {
        const deltas = applyOpenAICompatStreamChunk(state, chunk as unknown as ChatCompletionChunk);
        if (deltas.reasoningDelta.length > 0) {
          yield { type: "reasoning.delta", delta: deltas.reasoningDelta };
        }
        if (deltas.assistantDelta.length > 0) {
          yield { type: "assistant.delta", delta: deltas.assistantDelta };
        }
      }

      yield { type: "final", response: finalizeOpenAICompatStream(state) };
    } catch (error: unknown) {
      throw this.asProviderError(error);
    }
  }

  async complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse> {
    try {
      const client = this.createClient(auth);
      const body = {
        ...(this.toBody(request) as Record<string, unknown>),
        stream: false,
      } as unknown as ChatCompletionCreateParamsNonStreaming;
      const response = await client.chat.completions.create(body, { signal: request.signal });
      const parsed = parseOpenAICompatResponse(response as unknown as OpenAICompatResponse);
      if (!parsed) {
        throw new ProviderError(`${this.label()} returned no message`);
      }
      return parsed;
    } catch (error: unknown) {
      throw this.asProviderError(error);
    }
  }

  async createTokenCounter(model: string) {
    return createOpenAICompatibleTokenCounter(model);
  }

  /**
   * Lists models via the OpenAI-compatible `GET /models` endpoint. Works for
   * OpenAI itself as well as any compatible server that implements the same
   * endpoint (including Ollama's local server). Callers should treat a
   * thrown error as "discovery unavailable" and fall back to static routes.
   */
  async listModels(auth: ProviderAuth): Promise<ProviderModelInfo[]> {
    try {
      const client = this.createClient(auth);
      const page = await client.models.list();
      const models: ProviderModelInfo[] = [];
      for await (const model of page) {
        models.push({ id: model.id });
      }
      return models;
    } catch (error: unknown) {
      throw this.asProviderError(error);
    }
  }

  private createClient(auth: ProviderAuth): OpenAI {
    const baseURL = auth.baseUrl ?? this.defaultBaseUrl;
    if (!baseURL) {
      throw new ProviderError(
        `${this.label()}: no base URL configured (set credentials baseUrl or defaultBaseUrl)`,
      );
    }
    return new OpenAI({
      apiKey: auth.apiKey,
      baseURL,
      fetch: this.createFetch(),
      defaultHeaders: this.extraHeaders,
    });
  }

  private createFetch(): typeof fetch {
    if (this.authStyle !== "none") {
      return this.fetchImpl;
    }

    return async (input, init) => {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.delete("authorization");
      headers.delete("Authorization");
      return this.fetchImpl(input, { ...init, headers });
    };
  }

  private asProviderError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new ProviderError(`${this.label()} error: ${message}`);
  }

  private label(): string {
    return `Provider "${this.providerId}"`;
  }

  private toBody(request: CompletionRequest): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: this.mapDeveloperRoleToSystem && m.role === "developer" ? "system" : m.role,
        content: toOpenAIContent(m.content),
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
      ...(this.forceJsonMode ? { format: "json" } : {}),
    };
  }
}

function toOpenAIContent(content: string | ProviderContentPart[]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }
    if (part.type === "image") {
      return {
        type: "image_url",
        image_url: {
          url: `data:${part.mimeType};base64,${part.dataBase64}`,
          ...(part.detail ? { detail: part.detail } : {}),
        },
      };
    }
    return {
      type: "text",
      text: `[Attached file: ${part.filename} (${part.mimeType})]`,
    };
  });
}
