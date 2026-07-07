import { ConfigError } from "../shared/errors";
import type {
  ModelProfile,
  ModelRouteMetadata,
  ModelSelectionDecision,
  ModelSelectionInput,
} from "./types";

export type ModelTaskType = NonNullable<ModelSelectionInput["taskType"]>;
export type ModelTier = "fast" | "default" | "reasoning";

export function modelTierForTaskType(taskType: ModelTaskType): ModelTier {
  if (taskType === "fast") return "fast";
  if (taskType === "reasoning") return "reasoning";
  return "default";
}

export function modelTierMetadata(tier: ModelTier): ModelRouteMetadata {
  if (tier === "fast") {
    return { cost: 1, speed: 3, intelligence: 1, costSource: "heuristic", tags: ["fast"] };
  }
  if (tier === "reasoning") {
    return { cost: 3, speed: 1, intelligence: 3, costSource: "heuristic", tags: ["reasoning"] };
  }
  return { cost: 2, speed: 2, intelligence: 2, costSource: "heuristic", tags: ["default"] };
}

export function orderedProfileTierEntries(
  profile: ModelProfile,
): Array<{ model: string; tier: ModelTier }> {
  const entries: Array<{ model: string; tier: ModelTier }> = [];
  if (profile.fastModel) {
    entries.push({ model: profile.fastModel, tier: "fast" });
  }
  entries.push({ model: requireDefaultModel(profile), tier: "default" });
  if (profile.reasoningModel) {
    entries.push({ model: profile.reasoningModel, tier: "reasoning" });
  }
  return entries;
}

export function modelForTier(profile: ModelProfile, tier: ModelTier): string {
  const defaultModel = requireDefaultModel(profile);
  if (tier === "fast") return profile.fastModel ?? defaultModel;
  if (tier === "reasoning") return profile.reasoningModel ?? defaultModel;
  return defaultModel;
}

export function selectModelFromProfile(
  input: Pick<ModelSelectionInput, "overrideModel" | "promptHintModel">,
  profile: ModelProfile,
  preferredTier: ModelTier,
): ModelSelectionDecision {
  if (input.overrideModel) {
    return { model: input.overrideModel, reason: "override" };
  }
  if (input.promptHintModel) {
    return { model: input.promptHintModel, reason: "prompt-hint" };
  }
  return { model: modelForTier(profile, preferredTier), reason: "profile" };
}

function requireDefaultModel(profile: ModelProfile): string {
  if (!profile.defaultModel) {
    throw new ConfigError("No default model configured in ModelProfile");
  }
  return profile.defaultModel;
}
