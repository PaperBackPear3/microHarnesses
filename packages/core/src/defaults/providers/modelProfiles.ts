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
      defaultModel: "claude-sonnet-5",
      fastModel: "claude-haiku-4-5",
      reasoningModel: "claude-opus-4-8",
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
    defaultModel: "gpt-5.4",
    fastModel: "gpt-5.4-mini",
    reasoningModel: "gpt-5.5",
  };
}

/** Distinct model names a provider profile offers, fast to reasoning. */
export function availableModelChoices(provider: string): string[] {
  const profile = profileForProvider(provider);
  return [profile.fastModel, profile.defaultModel, profile.reasoningModel]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index);
}
