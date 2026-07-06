import type {
  ModelProfile,
  ModelSelectionDecision,
  ModelSelectionInput,
  ModelSelector,
} from "./types";

/** Coarse effort level used to pick between fast/default/reasoning models. */
export type EffortLevel = "low" | "medium" | "high";

export function parseEffort(value: string | undefined): EffortLevel | undefined {
  if (!value) return undefined;
  if (value === "low" || value === "medium" || value === "high") return value;
  if (value === "med") return "medium";
  return undefined;
}

/** Resolves the model a profile prescribes for a given effort level. */
export function modelForEffort(profile: ModelProfile, effort: EffortLevel): string {
  if (effort === "low") return profile.fastModel ?? profile.defaultModel;
  if (effort === "high") return profile.reasoningModel ?? profile.defaultModel;
  return profile.defaultModel;
}

/**
 * ModelSelector that honors overrides and prompt hints, then picks the
 * profile model matching a mutable effort level (falling back to task-type
 * routing at medium effort).
 */
export class EffortModelSelector implements ModelSelector {
  private effort: EffortLevel;

  constructor(effort: EffortLevel) {
    this.effort = effort;
  }

  setEffort(effort: EffortLevel): void {
    this.effort = effort;
  }

  getEffort(): EffortLevel {
    return this.effort;
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
