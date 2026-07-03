import { ConfigError } from "../shared/errors";
import type { ProviderAdapter, ProviderId } from "./types";

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  get(id: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new ConfigError(
        `Unknown provider "${id}"; registered: [${[...this.adapters.keys()].join(", ")}]`,
      );
    }
    return adapter;
  }

  has(id: ProviderId): boolean {
    return this.adapters.has(id);
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
