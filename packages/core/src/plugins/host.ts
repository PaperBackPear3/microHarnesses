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
import { PluginLoadError } from "../shared/errors";
import type { SkillRegistry } from "../skills/registry";
import type { SubagentSupervisor } from "../subagents/types";
import type { ToolRegistry } from "../tools/registry";
import type { HarnessPlugin, PluginApi } from "./types";

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
  private readonly registered = new Map<string, string[]>();
  /** Plugin that claimed each single-value global setter, for conflict detection. */
  private compressorOwner?: string;
  private modelSelectorOwner?: string;

  constructor(deps: PluginHostDeps) {
    this.deps = deps;
  }

  /** Plugin names registered so far, with their declared capabilities. */
  plugins(): ReadonlyMap<string, string[]> {
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

    return {
      registerTool: (tool) => {
        staged.push(() => this.deps.tools.register(tool));
      },
      registerSkill: (skill) => {
        if (!this.deps.skills) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" requested skills but no skill registry is configured`,
          );
        }
        const skills = this.deps.skills;
        staged.push(() => skills.register(skill));
      },
      onBeforeLoop: (hook) => {
        staged.push(() => this.deps.onBeforeLoop(hook));
      },
      onAfterLoop: (hook) => {
        staged.push(() => this.deps.onAfterLoop(hook));
      },
      setCompressor: (compressor) => {
        if (this.compressorOwner && this.compressorOwner !== plugin.name) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" sets the compressor already claimed by "${this.compressorOwner}"`,
          );
        }
        this.compressorOwner = plugin.name;
        staged.push(() => this.deps.setCompressor(compressor));
      },
      registerProvider: (adapter) => {
        staged.push(() => this.deps.providers.register(adapter));
      },
      registerCredentialsResolver: (providerId, resolver) => {
        staged.push(() => this.deps.credentials.register(providerId, resolver));
      },
      registerPolicyRule: (rule) => {
        staged.push(() => this.deps.policy.addRule(rule));
      },
      setModelSelector: (selector) => {
        if (this.modelSelectorOwner && this.modelSelectorOwner !== plugin.name) {
          throw new PluginLoadError(
            `Plugin "${plugin.name}" sets the model selector already claimed by "${this.modelSelectorOwner}"`,
          );
        }
        this.modelSelectorOwner = plugin.name;
        staged.push(() => this.deps.setModelSelector(selector));
      },
      get observability() {
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
          if (!this.deps.subagents) {
            throw new PluginLoadError(
              `Plugin "${plugin.name}" requested agent spawn but no subagent runner is configured`,
            );
          }
          return this.deps.subagents.run(options);
        },
        invoke: async (request) => {
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
