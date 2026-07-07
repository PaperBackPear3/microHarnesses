import { modelTierForTaskType, selectModelFromProfile } from "./profileSelection";
import type {
  ModelProfile,
  ModelSelectionDecision,
  ModelSelectionInput,
  ModelSelector,
} from "./types";

/**
 * Heuristic task-type inference from the raw user prompt. Lives in the default
 * selector (not the runtime loop) so compositions can swap in their own policy.
 */
export function inferTaskType(prompt: string): "default" | "reasoning" | "fast" {
  const lowered = prompt.toLowerCase();
  if (/\b(quick|brief|short|fast)\b/.test(lowered)) {
    return "fast";
  }
  if (/\b(reason|analy[sz]e|deep|step[- ]by[- ]step|complex|trade[- ]off)\b/.test(lowered)) {
    return "reasoning";
  }
  return "default";
}

export class DefaultModelSelector implements ModelSelector {
  select(input: ModelSelectionInput, profile: ModelProfile): ModelSelectionDecision {
    const taskType = input.taskType ?? inferTaskType(input.userPrompt ?? "");
    return selectModelFromProfile(input, profile, modelTierForTaskType(taskType));
  }
}
