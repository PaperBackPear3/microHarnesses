import type { ChannelRegistry } from "../channels/registry";
import type { CompressorFn } from "../context/types";
import type { ModelSelector } from "../model/types";
import type { CompositePolicyEngine } from "../policy/compositePolicyEngine";
import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { AgentInvokeRequest, AgentRunResult } from "../runtime/types";
import type { AfterLoopHook, BeforeLoopHook } from "../runtime/types";
import { PluginCapabilityError, PluginLoadError } from "../shared/errors";
import type { SkillRegistry } from "../skills/registry";
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
  channels?: ChannelRegistry;
  skills?: SkillRegistry;
  subagents?: SubagentRunner;
  invokeAgent?(request: AgentInvokeRequest): Promise<AgentRunResult>;
}

/**
 * Owns plugin registration: hands each plugin a PluginApi scoped to its
 * declared capabilities and records which plugin registered what.
 *
 * Registration is atomic per plugin: a plugin's contributions are staged while
 * its `register()` runs and only committed to the shared registries once it
 * resolves successfully. If `register()` throws, nothing it staged is applied.
 *
 * Capability guarding is a hygiene boundary (auditable surface), NOT a security
 * sandbox — plugin code runs with full host privileges.
 */
export class PluginHost {
  private readonly deps: PluginHostDeps;
  private readonly registered = new Map<string, PluginCapability[]>();
  /** Plugin that claimed each single-value global setter, for conflict detection. */
  private compressorOwner?: string;
  private modelSelectorOwner?: string;

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
      const staged: Array<() => void> = [];
      await plugin.register(this.apiFor(plugin, staged));
      for (const commit of staged) {
        commit();
      }
      this.registered.set(plugin.name, [...plugin.capabilities]);
    }
  }

  private apiFor(plugin: HarnessPlugin, staged: Array<() => void>): PluginApi {
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
        staged.push(() => this.deps.tools.register(tool));
      },
      registerChannel: (channel) => {
        guard("channels");
        if (!this.deps.channels) {
          throw new PluginCapabilityError(
            `Plugin "${plugin.name}" requested channels but no channel registry is configured`,
          );
        }
        const channels = this.deps.channels;
        staged.push(() => channels.register(channel));
      },
      registerSkill: (skill) => {
        guard("skills");
        if (!this.deps.skills) {
          throw new PluginCapabilityError(
            `Plugin "${plugin.name}" requested skills but no skill registry is configured`,
          );
        }
        const skills = this.deps.skills;
        staged.push(() => skills.register(skill));
      },
      onBeforeLoop: (hook) => {
        guard("hooks");
        staged.push(() => this.deps.onBeforeLoop(hook));
      },
      onAfterLoop: (hook) => {
        guard("hooks");
        staged.push(() => this.deps.onAfterLoop(hook));
      },
      setCompressor: (compressor) => {
        guard("compressor");
        if (this.compressorOwner && this.compressorOwner !== plugin.name) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" sets the compressor already claimed by "${this.compressorOwner}"`,
          );
        }
        this.compressorOwner = plugin.name;
        staged.push(() => this.deps.setCompressor(compressor));
      },
      registerProvider: (adapter) => {
        guard("providers");
        staged.push(() => this.deps.providers.register(adapter));
      },
      registerCredentialsResolver: (providerId, resolver) => {
        guard("credentials");
        staged.push(() => this.deps.credentials.register(providerId, resolver));
      },
      registerPolicyRule: (rule) => {
        guard("policy");
        staged.push(() => this.deps.policy.addRule(rule));
      },
      setModelSelector: (selector) => {
        guard("model-selector");
        if (this.modelSelectorOwner && this.modelSelectorOwner !== plugin.name) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" sets the model selector already claimed by "${this.modelSelectorOwner}"`,
          );
        }
        this.modelSelectorOwner = plugin.name;
        staged.push(() => this.deps.setModelSelector(selector));
      },
      agents: {
        spawn: async (options) => {
          guard("agents");
          if (!this.deps.subagents) {
            throw new PluginCapabilityError(
              `Plugin "${plugin.name}" requested agent spawn but no subagent runner is configured`,
            );
          }
          return this.deps.subagents.run(options);
        },
        invoke: async (request) => {
          guard("agents");
          if (!this.deps.invokeAgent) {
            throw new PluginCapabilityError(
              `Plugin "${plugin.name}" requested agent invoke but no agent invoker is configured`,
            );
          }
          return this.deps.invokeAgent(request);
        },
      },
    };
  }
}
