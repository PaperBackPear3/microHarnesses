import type { HarnessPlugin, PluginApi, PluginCapability } from "@micro-harnesses/core";
import { type AgenticCompressorOptions, createAgenticCompressor } from "./agenticCompressor";

export type AgenticCompressionPluginOptions = Omit<AgenticCompressorOptions, "spawn">;

/**
 * Registers a compressor that spawns a summarizer + goal-finder subagent pair
 * (via `PluginApi.agents.spawn`) to compress overflowed context turns, in
 * place of the heuristic `defaultCompressor`. Both subagents inherit
 * whatever model/provider/effort the host composition currently has
 * selected.
 */
export class AgenticCompressionPlugin implements HarnessPlugin {
  readonly name = "agentic-compression-plugin";
  readonly capabilities: PluginCapability[] = ["compressor", "agents"];
  private readonly options: AgenticCompressionPluginOptions;

  constructor(options: AgenticCompressionPluginOptions = {}) {
    this.options = options;
  }

  register(api: PluginApi): void {
    api.setCompressor(
      createAgenticCompressor({
        ...this.options,
        spawn: (request) => api.agents.spawn(request),
      }),
    );
  }
}
