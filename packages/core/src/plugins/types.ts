import type { ChannelDefinition } from "../channels/types";
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
import type { PolicyRule } from "../policy/types";
import type { CredentialsResolver, ProviderAdapter } from "../providers/types";
import type {
  AfterLoopHook,
  AgentInvokeRequest,
  AgentRunResult,
  BeforeLoopHook,
} from "../runtime/types";
import type { SkillDefinition } from "../skills/types";
import type { SubagentResult, SubagentRunOptions } from "../subagents/types";
import type { ToolDefinition } from "../tools/types";

export type PluginCapability =
  | "tools"
  | "hooks"
  | "compressor"
  | "providers"
  | "credentials"
  | "policy"
  | "model-selector"
  | "channels"
  | "skills"
  | "agents"
  | "observability";

/**
 * Observability surface handed to plugins that declare the "observability"
 * capability. Exposes read access to the tracer/meter/logger for custom
 * instrumentation and lets plugins register exporters (e.g. an OpenTelemetry
 * bridge) that receive every span, metric, and log the runtime produces.
 */
export interface PluginObservabilityApi {
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly logger: Logger;
  registerTraceExporter(exporter: TraceExporter): void;
  registerMetricExporter(exporter: MetricExporter): void;
  registerLogExporter(exporter: LogExporter): void;
}

/**
 * The extension surface handed to a plugin's `register`. Each method is gated
 * by the plugin's declared {@link PluginCapability capabilities}.
 *
 * NOTE: capability guarding is a *hygiene* boundary — it constrains which
 * PluginApi methods a plugin may call and makes a plugin's surface auditable.
 * It is NOT a security sandbox: plugin code runs with full process privileges
 * and registered tools/providers can do anything the host process can.
 */
export interface PluginApi {
  registerTool(tool: ToolDefinition): void;
  registerChannel(channel: ChannelDefinition): void;
  registerSkill(skill: SkillDefinition): void;
  onBeforeLoop(hook: BeforeLoopHook): void;
  onAfterLoop(hook: AfterLoopHook): void;
  setCompressor(compressor: CompressorFn): void;
  registerProvider(adapter: ProviderAdapter): void;
  registerCredentialsResolver(providerId: string, resolver: CredentialsResolver): void;
  /**
   * Registers a policy rule composed most-restrictive-wins by the
   * CompositePolicyEngine. Covers both tool gating and tool-governance rules
   * (rules can inspect `tool.riskProfile` / `tool.governance`).
   */
  registerPolicyRule(rule: PolicyRule): void;
  setModelSelector(selector: ModelSelector): void;
  /** Observability surface (gated by the "observability" capability). */
  observability: PluginObservabilityApi;
  /** Unified agent API path (preferred over `subagents`). */
  agents: {
    spawn(options: SubagentRunOptions): Promise<SubagentResult>;
    invoke(request: AgentInvokeRequest): Promise<AgentRunResult>;
  };
}

export interface HarnessPlugin {
  name: string;
  version?: string;
  /**
   * Capabilities this plugin uses. Required — the host rejects calls to
   * PluginApi surfaces outside the declared set.
   */
  capabilities: PluginCapability[];
  register(api: PluginApi): Promise<void> | void;
}
