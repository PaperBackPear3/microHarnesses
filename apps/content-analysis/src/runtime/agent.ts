import {
  CredentialsRegistry,
  FsPromptSource,
  ProviderRegistry,
  SessionStore,
  createCoreDefaultTools,
  defineAgent,
  type ToolDefinition,
} from "@micro-harnesses/core";
import type { ContentAnalysisConfig } from "../config.js";
import type { MessageContentPart } from "../inputs/assets.js";
import type { SessionStoreLike } from "../inputs/assets.js";
import { createContentAnalysisTools } from "../tools/index.js";

export interface AnalysisRunExecution {
  sessionId: string;
  goal: string;
  maxIterations: number;
  snapshotEvery: number;
  profile: { defaultModel: string };
}

export interface AnalysisAgentHandle {
  promptName: string;
  invoke(request: {
    prompt: string;
    input?: { text?: string; content?: MessageContentPart[] };
    execution: AnalysisRunExecution;
  }): Promise<{ summary: string }>;
}

export interface AnalysisAgents {
  config: ContentAnalysisConfig;
  sessionStore: SessionStoreLike;
  providerRegistry: ProviderRegistry;
  credentialsRegistry: CredentialsRegistry;
  mainAgent: AnalysisAgentHandle;
  visualAgent: AnalysisAgentHandle;
  documentAgent: AnalysisAgentHandle;
  synthesisAgent: AnalysisAgentHandle;
  tools: ToolDefinition[];
}

export function createAnalysisAgents(config: ContentAnalysisConfig): AnalysisAgents {
  const sessionStoreRaw = new SessionStore(config.stateDir);
  const sessionStore = sessionStoreRaw as unknown as SessionStoreLike;
  const providerRegistry = new ProviderRegistry();
  const credentialsRegistry = new CredentialsRegistry();
  const sharedTools = [
    ...createCoreDefaultTools({}),
    ...createContentAnalysisTools({ config, sessionStore }),
  ];
  const prompts = new FsPromptSource({ rootDir: config.promptsDir });

  const commonOptions = {
    model: {
      providerId: config.provider,
      model: config.model,
      maxTokens: config.maxTokens,
    },
    tools: sharedTools,
    prompts,
    sessionStore: sessionStoreRaw,
    includeBuiltInProviders: true,
    providerRegistry,
    credentialsRegistry,
    stateDir: config.stateDir,
    maxWorkingTurns: 8,
  } as const;

  const mainAgent = defineAgent({
    name: "content-analysis",
    ...commonOptions,
  }) as unknown as AnalysisAgentHandle;
  const visualAgent = defineAgent({
    name: "visual-analysis",
    ...commonOptions,
  }) as unknown as AnalysisAgentHandle;
  const documentAgent = defineAgent({
    name: "document-analysis",
    ...commonOptions,
  }) as unknown as AnalysisAgentHandle;
  const synthesisAgent = defineAgent({
    name: "synthesis",
    ...commonOptions,
  }) as unknown as AnalysisAgentHandle;

  return {
    config,
    sessionStore,
    providerRegistry,
    credentialsRegistry,
    mainAgent,
    visualAgent,
    documentAgent,
    synthesisAgent,
    tools: sharedTools,
  };
}
