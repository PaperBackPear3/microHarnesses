import type { ModelProfile, ModelSelectionDecision, ModelSelectionInput, ModelSelector } from "@micro-harnesses/core";
import type { EffortLevel } from "../config/config";

export class EffortModelSelector implements ModelSelector {
  private effort: EffortLevel;

  constructor(effort: EffortLevel) {
    this.effort = effort;
  }

  setEffort(effort: EffortLevel): void {
    this.effort = effort;
  }

  select(input: ModelSelectionInput, profile: ModelProfile): ModelSelectionDecision {
    if (input.overrideModel) {
      return { model: input.overrideModel, reason: "override" };
    }
    if (input.promptHintModel) {
      return { model: input.promptHintModel, reason: "prompt-hint" };
    }

    if (this.effort === "high") {
      return { model: profile.reasoningModel ?? profile.defaultModel, reason: "profile" };
    }
    if (this.effort === "low") {
      return { model: profile.fastModel ?? profile.defaultModel, reason: "profile" };
    }
    if (input.taskType === "reasoning" && profile.reasoningModel) {
      return { model: profile.reasoningModel, reason: "profile" };
    }
    if (input.taskType === "fast" && profile.fastModel) {
      return { model: profile.fastModel, reason: "profile" };
    }
    return { model: profile.defaultModel, reason: "profile" };
  }
}
