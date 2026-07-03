import type { CompressorFn } from "../context/types";
import type { ModelSelector } from "../model/types";
import type { CompositePolicyEngine } from "../policy/compositePolicyEngine";
import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { AfterLoopHook, BeforeLoopHook } from "../runtime/types";
import { PluginCapabilityError, PluginLoadError } from "../shared/errors";
import type { SubagentRunner } from "../subagents/types";
import type { ToolRegistry } from "../tools/registry";
import type { HarnessPlugin, PluginApi, PluginCapability } from "./types";

export interface PluginHostDeps {
  tools: ToolRegistry;
  providers: ProviderRegistry;
  credentials: CredentialsRegistry;
  policy: CompositePolicyEngine;
  onBeforeLoop(hook: BeforeLoopHook): void;
  onAfterLoop(hook: AfterLoopHook): void;
  setCompressor(compressor: CompressorFn): void;
  setModelSelector(selector: ModelSelector): void;
  subagents?: SubagentRunner;
}

/**
 * Owns plugin registration: hands each plugin a PluginApi scoped to its
 * declared capabilities and records which plugin registered what.
 */
export class PluginHost {
  private readonly deps: PluginHostDeps;
  private readonly registered = new Map<string, PluginCapability[]>();

  constructor(deps: PluginHostDeps) {
    this.deps = deps;
  }

  /** Plugin names registered so far, with their declared capabilities. */
  plugins(): ReadonlyMap<string, PluginCapability[]> {
    return this.registered;
  }

  async register(plugins: HarnessPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      if (!Array.isArray(plugin.capabilities)) {
        throw new PluginLoadError(
          `Plugin "${plugin.name}" must declare a capabilities array (e.g. ["tools"])`,
        );
      }
      if (this.registered.has(plugin.name)) {
        throw new PluginLoadError(`Plugin "${plugin.name}" is already registered`);
      }
      await plugin.register(this.apiFor(plugin));
      this.registered.set(plugin.name, [...plugin.capabilities]);
    }
  }

  private apiFor(plugin: HarnessPlugin): PluginApi {
    const guard = (capability: PluginCapability): void => {
      if (!plugin.capabilities.includes(capability)) {
        throw new PluginCapabilityError(
          `Plugin "${plugin.name}" used "${capability}" without declaring it in capabilities`,
        );
      }
    };

    return {
      registerTool: (tool) => {
        guard("tools");
        this.deps.tools.register(tool);
      },
      onBeforeLoop: (hook) => {
        guard("hooks");
        this.deps.onBeforeLoop(hook);
      },
      onAfterLoop: (hook) => {
        guard("hooks");
        this.deps.onAfterLoop(hook);
      },
      setCompressor: (compressor) => {
        guard("compressor");
        this.deps.setCompressor(compressor);
      },
      registerProvider: (adapter) => {
        guard("providers");
        this.deps.providers.register(adapter);
      },
      registerCredentialsResolver: (providerId, resolver) => {
        guard("credentials");
        this.deps.credentials.register(providerId, resolver);
      },
      registerPolicyRule: (rule) => {
        guard("policy");
        this.deps.policy.addRule(rule);
      },
      setModelSelector: (selector) => {
        guard("model-selector");
        this.deps.setModelSelector(selector);
      },
      subagents: {
        run: async (options) => {
          guard("subagents");
          if (!this.deps.subagents) {
            throw new PluginCapabilityError(
              `Plugin "${plugin.name}" requested a subagent run but no subagent runner is configured`,
            );
          }
          return this.deps.subagents.run(options);
        },
      },
    };
  }
}
