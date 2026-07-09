import {
  CredentialsRegistry,
  FsPromptSource,
  ProviderRegistry,
  defineAgent,
  type Agent,
} from "@micro-harnesses/core";
import type { RevenueOpsConfig } from "../config.js";

export interface RevenueOpsAgents {
  retentionAgent: Agent;
  collectionsAgent: Agent;
}

export function createRevenueOpsAgents(config: RevenueOpsConfig): RevenueOpsAgents {
  const providerRegistry = new ProviderRegistry();
  const credentialsRegistry = new CredentialsRegistry();
  const prompts = new FsPromptSource({ rootDir: config.promptsDir });

  const common = {
    model: {
      providerId: config.provider,
      model: config.model,
      maxTokens: config.maxTokens,
    },
    prompts,
    includeBuiltInProviders: true,
    providerRegistry,
    credentialsRegistry,
    stateDir: config.stateDir,
    maxWorkingTurns: 10,
    tools: [],
  };

  const retentionAgent = defineAgent({
    name: "retention",
    ...common,
  });

  const collectionsAgent = defineAgent({
    name: "collections",
    ...common,
  });

  return { retentionAgent, collectionsAgent };
}
