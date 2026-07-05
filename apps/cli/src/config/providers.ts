import type { ModelProfile } from "@micro-harnesses/core";
import type { EffortLevel } from "./config";

export function profileForProvider(provider: string, modelOverride?: string): ModelProfile {
  if (modelOverride) {
    return {
      defaultModel: modelOverride,
      fastModel: modelOverride,
      reasoningModel: modelOverride,
    };
  }

  if (provider === "anthropic") {
    return {
      defaultModel: "claude-sonnet-4-5",
      fastModel: "claude-3-5-haiku-latest",
      reasoningModel: "claude-opus-4-1",
    };
  }
  if (provider === "ollama") {
    return {
      defaultModel: "llama3.1:8b",
      fastModel: "llama3.1:8b",
      reasoningModel: "llama3.1:70b",
    };
  }
  return {
    defaultModel: "gpt-4.1",
    fastModel: "gpt-4.1-mini",
    reasoningModel: "o4-mini",
  };
}

export function availableModelChoices(provider: string): string[] {
  const profile = profileForProvider(provider);
  return [profile.fastModel, profile.defaultModel, profile.reasoningModel]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function modelForEffort(profile: ModelProfile, effort: EffortLevel): string {
  if (effort === "low") return profile.fastModel ?? profile.defaultModel;
  if (effort === "high") return profile.reasoningModel ?? profile.defaultModel;
  return profile.defaultModel;
}
