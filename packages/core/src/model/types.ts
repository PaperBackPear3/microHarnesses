import type { Turn } from "../context/types";
import type { PromptBundle } from "../prompts/types";
import type { ToolDescriptor } from "../tools/types";
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

export interface StepPlan {
  assistantMessage: string;
  toolCalls: ToolCall[];
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
  availableTools?: ToolDescriptor[];
  onAssistantDelta?: (delta: string) => void | Promise<void>;
}

export interface ModelAdapter {
  nextStep(input: StepInput): Promise<StepPlan>;
}
