import { AuthError } from "../shared/errors";
import type { ProviderAuth, ProviderCredentialsResolver, ProviderId } from "./types";

export class EnvCredentialsResolver implements ProviderCredentialsResolver {
  async resolve(provider: ProviderId): Promise<ProviderAuth> {
    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new AuthError("Missing OPENAI_API_KEY");
      }
      return {
        apiKey,
        baseUrl: process.env.OPENAI_BASE_URL,
      };
    }

    if (provider === "ollama") {
      return {
        apiKey: process.env.OLLAMA_API_KEY ?? "ollama",
        baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
      };
    }

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
