import { ConfigError } from "../shared/errors";
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
    if (input.overrideModel) {
      return { model: input.overrideModel, reason: "override" };
    }

    if (input.promptHintModel) {
      return { model: input.promptHintModel, reason: "prompt-hint" };
    }

    const taskType = input.taskType ?? inferTaskType(input.userPrompt ?? "");

    if (taskType === "reasoning" && profile.reasoningModel) {
      return { model: profile.reasoningModel, reason: "profile" };
    }

    if (taskType === "fast" && profile.fastModel) {
      return { model: profile.fastModel, reason: "profile" };
    }

    if (profile.defaultModel) {
      return { model: profile.defaultModel, reason: "profile" };
    }

    throw new ConfigError("No default model configured in ModelProfile");
  }
}
