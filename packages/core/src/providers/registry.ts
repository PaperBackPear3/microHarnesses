import { ProviderAdapter, ProviderId } from "../types";

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  get(id: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`No provider adapter for ${id}`);
    }
    return adapter;
  }
}
