import {
  CredentialsRegistry,
  FsPromptSource,
  OllamaAdapter,
  OllamaEnvCredentials,
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
import { log } from "./logger.js";

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
    // Built-in providers registered first; we then override ollama below.
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

  // Override the built-in Ollama adapter with forceJsonMode so models like
  // Gemma reliably emit JSON instead of conversational prose.
  if (config.provider === "ollama") {
    const jsonOllama = new OllamaAdapter({
      defaultModel: config.model,
      forceJsonMode: true,
    });
    providerRegistry.register(jsonOllama);
    credentialsRegistry.register("ollama", new OllamaEnvCredentials());
    log("info", "provider", `Registered Ollama adapter with forceJsonMode=true (model=${config.model})`);
  }

  const visualAgent = defineAgent({
    name: "visual-analysis",
    ...commonOptions,
  }) as unknown as AnalysisAgentHandle;
  const documentAgent = defineAgent({
    name: "document-analysis",
    ...commonOptions,
  }) as unknown as AnalysisAgentHandle;
  // Synthesis only merges JSON drafts — give it no tools so it cannot waste
  // iterations trying to read files that may already be cleaned up.
  const synthesisAgent = defineAgent({
    name: "synthesis",
    ...commonOptions,
    tools: [],
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
