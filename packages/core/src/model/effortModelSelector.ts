import {
  type ModelTier,
  modelForTier,
  modelTierForTaskType,
  selectModelFromProfile,
} from "./profileSelection";
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
  return modelForTier(profile, tierForEffort(effort));
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
    const preferredTier = tierForEffort(this.effort);
    const tier =
      preferredTier === "default"
        ? modelTierForTaskType(input.taskType ?? "default")
        : preferredTier;
    return selectModelFromProfile(input, profile, tier);
  }
}

function tierForEffort(effort: EffortLevel): ModelTier {
  if (effort === "low") return "fast";
  if (effort === "high") return "reasoning";
  return "default";
}
