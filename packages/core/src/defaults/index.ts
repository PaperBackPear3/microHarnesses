import type { CredentialsRegistry } from "../providers/credentialsRegistry";
import type { ProviderRegistry } from "../providers/registry";
import type { SubagentRunner } from "../subagents/types";
import type { ToolRegistry } from "../tools/registry";
import { registerBuiltInProviders } from "./providers/plugins";
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
  workspaceTools: ReadOnlyWorkspaceToolsOptions;
  subagents?: SubagentRunner;
  spawnSubagent?: SpawnSubagentToolOptions;
}

/**
 * Registers default providers, credentials resolvers, and read-only core tools.
 * Default tools follow the same tool catalog/governance contract as any custom tool.
 */
export function registerCoreDefaults(options: RegisterCoreDefaultsOptions): void {
  registerBuiltInProviders(options.providerRegistry, options.credentialsRegistry);

  for (const tool of createReadOnlyWorkspaceTools(options.workspaceTools)) {
    options.toolRegistry.register(tool);
  }

  if (options.subagents) {
    options.toolRegistry.register(
      createSpawnSubagentTool(options.subagents, options.spawnSubagent),
    );
  }
}
