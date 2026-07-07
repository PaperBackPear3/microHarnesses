import type { CompressorFn } from "../context/types";
import type { ModelSelector } from "../model/types";
import type {
  LogExporter,
  Logger,
  Meter,
  MetricExporter,
  TraceExporter,
  Tracer,
} from "../observability/types";
import type { CompositePolicyEngine } from "../policy/compositePolicyEngine";
import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { AgentInvokeRequest, AgentRunResult } from "../runtime/types";
import type { AfterLoopHook, BeforeLoopHook } from "../runtime/types";
import { PluginCapabilityError, PluginLoadError } from "../shared/errors";
import type { SkillRegistry } from "../skills/registry";
import type { SubagentSupervisor } from "../subagents/types";
import type { ToolRegistry } from "../tools/registry";
import type { ChannelRegistry } from "../channels/registry";
import type { HarnessPlugin, PluginApi, PluginCapability } from "./types";

/** Host wiring for the plugin observability surface. */
export interface PluginObservabilityHost {
  tracer: Tracer;
  meter: Meter;
  logger: Logger;
  registerTraceExporter(exporter: TraceExporter): void;
  registerMetricExporter(exporter: MetricExporter): void;
  registerLogExporter(exporter: LogExporter): void;
}

export interface PluginHostDeps {
  tools: ToolRegistry;
  providers: ProviderRegistry;
  credentials: CredentialsRegistry;
  policy: CompositePolicyEngine;
  onBeforeLoop(hook: BeforeLoopHook): void;
  onAfterLoop(hook: AfterLoopHook): void;
  setCompressor(compressor: CompressorFn): void;
  setModelSelector(selector: ModelSelector): void;
  skills?: SkillRegistry;
  channels?: ChannelRegistry;
  subagents?: SubagentSupervisor;
  observability?: PluginObservabilityHost;
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
      if (this.registered.has(plugin.name)) {
        throw new PluginLoadError(`Plugin "${plugin.name}" is already registered`);
      }
      const staged: Array<() => void> = [];
      await plugin.register(this.apiFor(plugin, staged));
      for (const commit of staged) {
        commit();
      }
      this.registered.set(plugin.name, [...(plugin.capabilities ?? [])]);
    }
  }

  private apiFor(plugin: HarnessPlugin, staged: Array<() => void>): PluginApi {
    const observabilityHost = this.deps.observability;
    const declared = new Set(plugin.capabilities ?? []);
    const hasCapability = (capability: PluginCapability): boolean => declared.has(capability);
    const assertCapability = (capability: PluginCapability, surface: string): void => {
      if (hasCapability(capability)) return;
      throw new PluginCapabilityError(
        `Plugin "${plugin.name}" used "${surface}" but did not declare "${capability}" capability`,
      );
    };

    return {
      registerTool: (tool) => {
        assertCapability("tools", "registerTool");
        staged.push(() => this.deps.tools.register(tool));
      },
      registerChannel: (adapter) => {
        assertCapability("channels", "registerChannel");
        if (!this.deps.channels) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" requested channels but no channel registry is configured`,
          );
        }
        const channels = this.deps.channels;
        staged.push(() => channels.register(adapter));
      },
      registerSkill: (skill) => {
        assertCapability("skills", "registerSkill");
        if (!this.deps.skills) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" requested skills but no skill registry is configured`,
          );
        }
        const skills = this.deps.skills;
        staged.push(() => skills.register(skill));
      },
      onBeforeLoop: (hook) => {
        assertCapability("hooks", "onBeforeLoop");
        staged.push(() => this.deps.onBeforeLoop(hook));
      },
      onAfterLoop: (hook) => {
        assertCapability("hooks", "onAfterLoop");
        staged.push(() => this.deps.onAfterLoop(hook));
      },
      setCompressor: (compressor) => {
        assertCapability("compressor", "setCompressor");
        if (this.compressorOwner && this.compressorOwner !== plugin.name) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" sets the compressor already claimed by "${this.compressorOwner}"`,
          );
        }
        this.compressorOwner = plugin.name;
        staged.push(() => this.deps.setCompressor(compressor));
      },
      registerProvider: (adapter) => {
        assertCapability("providers", "registerProvider");
        staged.push(() => this.deps.providers.register(adapter));
      },
      registerCredentialsResolver: (providerId, resolver) => {
        assertCapability("credentials", "registerCredentialsResolver");
        staged.push(() => this.deps.credentials.register(providerId, resolver));
      },
      registerPolicyRule: (rule) => {
        assertCapability("policy", "registerPolicyRule");
        staged.push(() => this.deps.policy.addRule(rule));
      },
      setModelSelector: (selector) => {
        assertCapability("model-selector", "setModelSelector");
        if (this.modelSelectorOwner && this.modelSelectorOwner !== plugin.name) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" sets the model selector already claimed by "${this.modelSelectorOwner}"`,
          );
        }
        this.modelSelectorOwner = plugin.name;
        staged.push(() => this.deps.setModelSelector(selector));
      },
      get observability() {
        assertCapability("observability", "observability");
        const host = observabilityHost;
        if (!host) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" requested observability but no provider is configured`,
          );
        }
        return {
          tracer: host.tracer,
          meter: host.meter,
          logger: host.logger,
          registerTraceExporter: (exporter: TraceExporter) => {
            staged.push(() => host.registerTraceExporter(exporter));
          },
          registerMetricExporter: (exporter: MetricExporter) => {
            staged.push(() => host.registerMetricExporter(exporter));
          },
          registerLogExporter: (exporter: LogExporter) => {
            staged.push(() => host.registerLogExporter(exporter));
          },
        };
      },
      agents: {
        spawn: async (options) => {
          assertCapability("agents", "agents.spawn");
          if (!this.deps.subagents) {
            throw new PluginLoadError(
              `Plugin "${plugin.name}" requested agent spawn but no subagent runner is configured`,
            );
          }
          return this.deps.subagents.run(options);
        },
        invoke: async (request) => {
          assertCapability("agents", "agents.invoke");
          if (!this.deps.invokeAgent) {
            throw new PluginLoadError(
              `Plugin "${plugin.name}" requested agent invoke but no agent invoker is configured`,
            );
          }
          return this.deps.invokeAgent(request);
        },
      },
    };
  }
}
