import { AuthError } from "../errors";
import { ProviderAuth, ProviderCredentialsResolver, ProviderId } from "../types";

export class EnvCredentialsResolver implements ProviderCredentialsResolver {
  async resolve(provider: ProviderId): Promise<ProviderAuth> {
    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new AuthError("Missing OPENAI_API_KEY");
      }
      return {
        apiKey,
        baseUrl: process.env.OPENAI_BASE_URL
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AuthError("Missing ANTHROPIC_API_KEY");
    }
    return {
      apiKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL
    };
  }
}
