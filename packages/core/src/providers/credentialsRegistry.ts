import { AuthError } from "../shared/errors";
import type { CredentialsResolver } from "./types";

export class CredentialsRegistry {
  private readonly resolvers = new Map<string, CredentialsResolver>();

  register(providerId: string, resolver: CredentialsResolver): void {
    this.resolvers.set(providerId, resolver);
  }

  get(providerId: string): CredentialsResolver {
    const resolver = this.resolvers.get(providerId);
    if (!resolver) {
      throw new AuthError(
        `No credentials resolver for provider "${providerId}"; registered: [${[...this.resolvers.keys()].join(", ")}]`,
      );
    }
    return resolver;
  }

  has(providerId: string): boolean {
    return this.resolvers.has(providerId);
  }
}
