import type { ChannelRegistry } from "../channels/registry";
import type { ModelRoute } from "../model/types";
import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { CredentialsResolver, ProviderAdapter } from "../providers/types";
import type { AfterLoopHook, BeforeLoopHook } from "../runtime/types";
import { ValidationError } from "../shared/errors";
import type { SubagentService } from "../subagents/types";
import type { ToolRegistry } from "../tools/registry";
import type { ToolDefinition } from "../tools/types";
import { registerBuiltInProviders, registerProviders } from "./providers/plugins";
import { type ChannelToolsOptions, createChannelTools } from "./tools/channels";
import { createListModelRoutesTool } from "./tools/listModelRoutesTool";
import { type PlanModeToolsOptions, createPlanModeTools } from "./tools/planMode";
import {
  type SpawnSubagentToolOptions,
  createSpawnSubagentTool,
  createWaitSubagentsTool,
} from "./tools/spawnSubagentTool";
import { createToolOutputReadTool } from "./tools/toolOutputRead";
import {
  type ReadOnlyWorkspaceToolsOptions,
  createReadOnlyWorkspaceTools,
} from "./tools/workspaceReadOnly";

export * from "./providers";
export * from "./tools/planMode";
export * from "./tools/workspaceReadOnly";
export * from "./tools/spawnSubagentTool";
export * from "./tools/toolOutputRead";
export * from "./tools/channels";
export * from "./tools/listModelRoutesTool";

export interface LoopHookRegistrar {
  onBeforeLoop(hook: BeforeLoopHook): void;
  onAfterLoop(hook: AfterLoopHook): void;
}

export interface RegisterCoreDefaultsOptions {
  providerRegistry: ProviderRegistry;
  credentialsRegistry: CredentialsRegistry;
  toolRegistry: ToolRegistry;
  /**
   * Built-in providers are enabled by default. Set to false to register only
   * custom providers.
   */
  includeBuiltInProviders?: boolean;
  /** Extra providers defined by the composition root. */
  providers?: Array<{
    adapter: ProviderAdapter;
    credentials?: CredentialsResolver;
  }>;
  /** Explicit tools to register in the runtime's tool catalog. */
  tools?: ToolDefinition[];
  /** Runtime/composition hook target. Required when beforeHooks/afterHooks are provided. */
  hookRegistrar?: LoopHookRegistrar;
  /** Native before-loop hooks to register in declaration order. */
  beforeHooks?: BeforeLoopHook[];
  /** Native after-loop hooks to register in declaration order. */
  afterHooks?: AfterLoopHook[];
}

export interface CreateCoreDefaultToolsOptions {
  workspaceTools?: ReadOnlyWorkspaceToolsOptions;
  planModeTools?: PlanModeToolsOptions;
  channelTools?: Omit<ChannelToolsOptions, "registry"> & { registry: ChannelRegistry };
  subagents?: SubagentService;
  spawnSubagent?: SpawnSubagentToolOptions;
  /**
   * When provided, registers the `list_model_routes` tool so models can query
   * the available route catalog before making routing decisions (e.g. before
   * spawning a subagent with a specific model).
   */
  listModelRoutes?: { routeCatalog: () => ModelRoute[] };
}

export function createCoreDefaultTools(options: CreateCoreDefaultToolsOptions): ToolDefinition[] {
  const tools: ToolDefinition[] = [createToolOutputReadTool()];
  if (options.workspaceTools) {
    tools.push(...createReadOnlyWorkspaceTools(options.workspaceTools));
  }
  if (options.planModeTools) {
    tools.push(...createPlanModeTools(options.planModeTools));
  }
  if (options.channelTools) {
    tools.push(...createChannelTools(options.channelTools));
  }
  if (options.subagents) {
    tools.push(createSpawnSubagentTool(options.subagents, options.spawnSubagent));
    tools.push(createWaitSubagentsTool(options.subagents));
  }
  if (options.listModelRoutes) {
    tools.push(createListModelRoutesTool(options.listModelRoutes.routeCatalog));
  }
  return tools;
}

export function registerTools(toolRegistry: ToolRegistry, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    toolRegistry.register(tool);
  }
}

/**
 * Registers core-native provider and tool capabilities.
 * Compositions control which tools/providers are enabled.
 */
export function registerCoreDefaults(options: RegisterCoreDefaultsOptions): void {
  if (options.includeBuiltInProviders !== false) {
    registerBuiltInProviders(options.providerRegistry, options.credentialsRegistry);
  }
  if (options.providers && options.providers.length > 0) {
    registerProviders(options.providerRegistry, options.credentialsRegistry, options.providers);
  }

  if (options.tools && options.tools.length > 0) {
    registerTools(options.toolRegistry, options.tools);
  }

  const beforeHooks = options.beforeHooks ?? [];
  const afterHooks = options.afterHooks ?? [];
  if (beforeHooks.length === 0 && afterHooks.length === 0) return;
  if (!options.hookRegistrar) {
    throw new ValidationError(
      "registerCoreDefaults requires hookRegistrar when beforeHooks/afterHooks are provided",
    );
  }
  for (const hook of beforeHooks) {
    options.hookRegistrar.onBeforeLoop(hook);
  }
  for (const hook of afterHooks) {
    options.hookRegistrar.onAfterLoop(hook);
  }
}
