import { DuplicateChannelError, UnknownChannelError } from "../shared/errors";
import type { ChannelDefinition } from "./types";

export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelDefinition>();

  register(channel: ChannelDefinition): void {
    if (this.channels.has(channel.id)) {
      throw new DuplicateChannelError(`Channel "${channel.id}" is already registered`);
    }
    this.channels.set(channel.id, channel);
  }

  get(id: string): ChannelDefinition {
    const channel = this.channels.get(id);
    if (!channel) {
      throw new UnknownChannelError(`Unknown channel: "${id}"`);
    }
    return channel;
  }

  list(): ChannelDefinition[] {
    return [...this.channels.values()];
  }
}
