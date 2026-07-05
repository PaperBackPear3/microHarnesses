import type { ChannelDefinition } from "./types";

export const inProcessChannel: ChannelDefinition = {
  id: "in_process",
  description: "Default in-process channel that maps input directly to runtime invocation.",
  async handle(request, context) {
    return context.invoke(request);
  },
};
