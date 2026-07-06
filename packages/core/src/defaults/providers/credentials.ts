import type { CredentialsResolver, ProviderAuth } from "../../providers/types";
import { AuthError } from "../../shared/errors";

export interface EnvCredentialsOptions {
  /** Env var holding the API key (e.g. "OPENROUTER_API_KEY"). */
  apiKeyEnv?: string;
  /** Env var that may override the base URL (e.g. "OPENROUTER_BASE_URL"). */
  baseUrlEnv?: string;
  /** Base URL used when the env override is absent. */
  defaultBaseUrl?: string;
  /** API key used when the env var is absent (for keyless local servers). */
  defaultApiKey?: string;
}

/**
 * Generic env-var credentials resolver for any provider. Throws AuthError when
 * an apiKeyEnv is configured, unset, and no defaultApiKey fallback exists.
 */
export class EnvCredentials implements CredentialsResolver {
  private readonly options: EnvCredentialsOptions;

  constructor(options: EnvCredentialsOptions) {
    this.options = options;
  }

  async resolve(): Promise<ProviderAuth> {
    const fromEnv = this.options.apiKeyEnv ? process.env[this.options.apiKeyEnv] : undefined;
    const apiKey = fromEnv ?? this.options.defaultApiKey;
    if (!apiKey) {
      throw new AuthError(`Missing ${this.options.apiKeyEnv ?? "API key"}`);
    }
    const baseUrlOverride = this.options.baseUrlEnv
      ? process.env[this.options.baseUrlEnv]
      : undefined;
    return {
      apiKey,
      baseUrl: baseUrlOverride ?? this.options.defaultBaseUrl,
    };
  }
}

export class OpenAIEnvCredentials extends EnvCredentials {
  constructor() {
    super({ apiKeyEnv: "OPENAI_API_KEY", baseUrlEnv: "OPENAI_BASE_URL" });
  }
}

export class AnthropicEnvCredentials extends EnvCredentials {
  constructor() {
    super({ apiKeyEnv: "ANTHROPIC_API_KEY", baseUrlEnv: "ANTHROPIC_BASE_URL" });
  }
}

export class OllamaEnvCredentials extends EnvCredentials {
  constructor() {
    super({
      apiKeyEnv: "OLLAMA_API_KEY",
      baseUrlEnv: "OLLAMA_BASE_URL",
      defaultApiKey: "ollama",
      defaultBaseUrl: "http://127.0.0.1:11434/v1",
    });
  }
}
