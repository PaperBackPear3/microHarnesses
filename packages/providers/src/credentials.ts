import { AuthError, type CredentialsResolver, type ProviderAuth } from "@micro-harness/core";

export class OpenAIEnvCredentials implements CredentialsResolver {
  async resolve(): Promise<ProviderAuth> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new AuthError("Missing OPENAI_API_KEY");
    }
    return {
      apiKey,
      baseUrl: process.env.OPENAI_BASE_URL,
    };
  }
}

export class AnthropicEnvCredentials implements CredentialsResolver {
  async resolve(): Promise<ProviderAuth> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AuthError("Missing ANTHROPIC_API_KEY");
    }
    return {
      apiKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    };
  }
}

export class OllamaEnvCredentials implements CredentialsResolver {
  async resolve(): Promise<ProviderAuth> {
    return {
      apiKey: process.env.OLLAMA_API_KEY ?? "ollama",
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
    };
  }
}
