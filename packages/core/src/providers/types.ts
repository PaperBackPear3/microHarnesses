import type { TokenCounter } from "../observability/types";
import type { ToolDescriptor } from "../tools/types";

export interface ProviderAuth {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Open identifier — providers are validated against the registry at runtime,
 * so plugins can register providers core has never heard of.
 */
export type ProviderId = string;

/** Resolves auth for one provider; the registry key carries the provider id. */
export interface CredentialsResolver {
  resolve(): Promise<ProviderAuth>;
}

export interface ProviderMessage {
  role: "system" | "developer" | "user" | "assistant";
  content: string | ProviderContentPart[];
}

export type ProviderContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      mimeType: string;
      dataBase64: string;
      filename?: string;
      detail?: "low" | "high" | "auto";
      altText?: string;
    }
  | {
      type: "file";
      mimeType: string;
      dataBase64: string;
      filename: string;
      title?: string;
    };

export interface ProviderToolCall {
  name: string;
  input: Record<string, unknown>;
  /** Set when the provider returned tool arguments that could not be parsed as JSON. */
  malformedInput?: boolean;
}

export interface ProviderResponse {
  assistantMessage: string;
  reasoningMessage?: string;
  toolCalls: ProviderToolCall[];
  stop: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export type ProviderStreamEvent =
  | {
      type: "assistant.delta";
      delta: string;
    }
  | {
      type: "reasoning.delta";
      delta: string;
    }
  | {
      type: "final";
      response: ProviderResponse;
    };

export interface CompletionRequest {
  model: string;
  messages: ProviderMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDescriptor[];
  /** Names of available executable skills (plugins/subagents). */
  availableSkills?: string[];
  /** Aborted when the run is killed; adapters should pass it to their HTTP call. */
  signal?: AbortSignal;
}

/** Minimal model metadata returned by a provider's live model-list endpoint. */
export interface ProviderModelInfo {
  id: string;
  label?: string;
  contextWindowTokens?: number;
}

export interface ProviderAdapter {
  providerId: ProviderId;
  /** Model used when the composition root does not specify one. */
  defaultModel?: string;
  features?: {
    structuredTools?: boolean;
    inputParts?: {
      text: boolean;
      image?: boolean;
      file?: boolean;
      urlSource?: boolean;
      inlineBinary?: boolean;
    };
  };
  streamComplete?(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent>;
  complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse>;
  /**
   * Optional provider/model-specific token counter used for context-window
   * estimation (compaction thresholds, utilization stats).
   */
  createTokenCounter?(
    model: string,
    auth?: ProviderAuth,
  ):
    | TokenCounter
    | { counter: TokenCounter; estimator?: string }
    | Promise<TokenCounter | { counter: TokenCounter; estimator?: string }>;
  /**
   * Optional live model discovery (e.g. `GET /models`). Used by CLIs/UIs to
   * list and validate actually-available models (notably for local servers
   * like Ollama, where availability depends on what the user has pulled).
   * Not required for normal completion calls; callers should treat a missing
   * implementation or a thrown error as "discovery unavailable" and fall
   * back to static/catalog routes.
   */
  listModels?(auth: ProviderAuth): Promise<ProviderModelInfo[]>;
}
