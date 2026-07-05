import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { CredentialsResolver, ProviderAdapter } from "../providers/types";
import type { SubagentRunner } from "../subagents/types";
import type { ToolRegistry } from "../tools/registry";
import type { ToolDefinition } from "../tools/types";
import { registerBuiltInProviders, registerProviders } from "./providers/plugins";
import { type SpawnSubagentToolOptions, createSpawnSubagentTool } from "./tools/spawnSubagentTool";
import {
  type ReadOnlyWorkspaceToolsOptions,
  createReadOnlyWorkspaceTools,
} from "./tools/workspaceReadOnly";

export * from "./providers";
export * from "./tools/workspaceReadOnly";
export * from "./tools/spawnSubagentTool";

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
}

export interface CreateCoreDefaultToolsOptions {
  workspaceTools?: ReadOnlyWorkspaceToolsOptions;
  subagents?: SubagentRunner;
  spawnSubagent?: SpawnSubagentToolOptions;
}

export function createCoreDefaultTools(options: CreateCoreDefaultToolsOptions): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (options.workspaceTools) {
    tools.push(...createReadOnlyWorkspaceTools(options.workspaceTools));
  }
  if (options.subagents) {
    tools.push(createSpawnSubagentTool(options.subagents, options.spawnSubagent));
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
}
