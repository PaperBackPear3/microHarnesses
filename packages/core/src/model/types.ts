import type { Turn } from "../context/types";
import type { PromptBundle } from "../prompts/types";
import type { ToolCall } from "../tools/types";

export interface ModelProfile {
  defaultModel: string;
  reasoningModel?: string;
  fastModel?: string;
}

export interface ModelSelectionInput {
  agentName: string;
  iteration: number;
  taskType?: "default" | "reasoning" | "fast";
  overrideModel?: string;
  promptHintModel?: string;
}

export interface ModelSelectionDecision {
  model: string;
  reason: "override" | "prompt-hint" | "profile";
}

export interface ModelSelector {
  select(input: ModelSelectionInput, profile: ModelProfile): ModelSelectionDecision;
}

export interface SpawnRequest {
  prompt: string;
}

export interface StepPlan {
  assistantMessage: string;
  toolCalls: ToolCall[];
  spawnRequest?: SpawnRequest;
  stop: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface StepInput {
  agentName: string;
  userPrompt: string;
  bundle: PromptBundle;
  workingTurns: Turn[];
  iteration: number;
  selectedModel?: string;
}

export interface ModelAdapter {
  nextStep(input: StepInput): Promise<StepPlan>;
}
