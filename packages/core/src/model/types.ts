import type { CompressionResult } from "../context/types";
import type { PromptBundle } from "../prompts/types";
import type { Turn } from "../runtime/state";
import type { SkillCall } from "../skills/types";
import type { ToolDescriptor } from "../tools/types";
import type { ToolCall } from "../tools/types";

export interface ModelProfile {
  defaultModel: string;
  reasoningModel?: string;
  fastModel?: string;
}

export interface ModelSelectionInput {
  promptName: string;
  iteration: number;
  /** Explicit task-type hint from prompt metadata; when absent the selector may infer one. */
  taskType?: "default" | "reasoning" | "fast";
  /** Raw user prompt, available to selectors that infer task type heuristically. */
  userPrompt?: string;
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
  skillCalls?: SkillCall[];
  stop: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface StepInput {
  promptName: string;
  userPrompt: string;
  bundle: PromptBundle;
  workingTurns: Turn[];
  /** Compressed summary of older, overflowed turns to reinject as prior context. */
  summary?: CompressionResult;
  iteration: number;
  selectedModel?: string;
  availableTools?: ToolDescriptor[];
  availableSkills?: string[];
  /** Aborted when the run is killed; adapters should abandon in-flight requests. */
  signal?: AbortSignal;
  onAssistantDelta?: (delta: string) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export interface ModelAdapter {
  nextStep(input: StepInput): Promise<StepPlan>;
}
