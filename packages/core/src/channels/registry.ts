import { DuplicateChannelError, UnknownChannelError } from "../shared/errors";
import type {
  ChannelAdapter,
  ChannelCatalogEntry,
  ChannelCatalogQuery,
  ChannelId,
} from "./types";

export class ChannelRegistry {
  private readonly adapters = new Map<ChannelId, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.channelId)) {
      throw new DuplicateChannelError(`Channel "${adapter.channelId}" is already registered`);
    }
    this.adapters.set(adapter.channelId, adapter);
  }

  get(channelId: ChannelId): ChannelAdapter {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      throw new UnknownChannelError(`Unknown channel: "${channelId}"`);
    }
    return adapter;
  }

  has(channelId: ChannelId): boolean {
    return this.adapters.has(channelId);
  }

  list(): ChannelAdapter[] {
    return [...this.adapters.values()];
  }

  catalog(query: ChannelCatalogQuery = {}): ChannelCatalogEntry[] {
    return this.list()
      .filter((adapter) => {
        if (query.transport && adapter.transport !== query.transport) return false;
        if (query.tag && !(adapter.tags ?? []).includes(query.tag)) return false;
        if (query.capability && !(adapter.capabilities ?? []).includes(query.capability)) {
          return false;
        }
        return true;
      })
      .map((adapter) => ({
        channelId: adapter.channelId,
        description: adapter.description,
        transport: adapter.transport,
        tags: [...(adapter.tags ?? [])],
        capabilities: [...(adapter.capabilities ?? [])],
      }));
  }
}
