import type { ModelProfile } from "../../model/types";

/**
 * Default fast/default/reasoning model profiles for the built-in providers.
 * A model override collapses the profile to that single model.
 */
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

/** Distinct model names a provider profile offers, fast to reasoning. */
export function availableModelChoices(provider: string): string[] {
  const profile = profileForProvider(provider);
  return [profile.fastModel, profile.defaultModel, profile.reasoningModel]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index);
}
