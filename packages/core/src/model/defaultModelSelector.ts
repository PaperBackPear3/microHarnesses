import { ModelProfile, ModelSelectionDecision, ModelSelectionInput, ModelSelector } from "../types";

export class DefaultModelSelector implements ModelSelector {
  select(input: ModelSelectionInput, profile: ModelProfile): ModelSelectionDecision {
    if (input.overrideModel) {
      return { model: input.overrideModel, reason: "override" };
    }

    if (input.promptHintModel) {
      return { model: input.promptHintModel, reason: "prompt-hint" };
    }

    if (input.taskType === "reasoning" && profile.reasoningModel) {
      return { model: profile.reasoningModel, reason: "profile" };
    }

    if (input.taskType === "fast" && profile.fastModel) {
      return { model: profile.fastModel, reason: "profile" };
    }

    if (profile.defaultModel) {
      return { model: profile.defaultModel, reason: "profile" };
    }

    throw new Error("No default model configured in ModelProfile");
  }
}
