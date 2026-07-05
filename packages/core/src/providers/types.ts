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
  content: string;
}

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
  /** Aborted when the run is killed; adapters should pass it to their HTTP call. */
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  providerId: ProviderId;
  /** Model used when the composition root does not specify one. */
  defaultModel?: string;
  features?: {
    structuredTools?: boolean;
  };
  streamComplete?(
    request: CompletionRequest,
    auth: ProviderAuth,
  ): AsyncIterable<ProviderStreamEvent>;
  complete(request: CompletionRequest, auth: ProviderAuth): Promise<ProviderResponse>;
}
