import type { ModelRoute, ModelRouteMetadata } from "../../model/types";
import type { ProviderAdapter, ProviderAuth } from "../../providers/types";
import { costRatingFromPricing, lookupKnownModelInfo } from "./modelCatalog";
import { profileForProvider } from "./modelProfiles";

type ProfileTier = "fast" | "default" | "reasoning";

/**
 * Builds a static route catalog from a provider's fast/default/reasoning
 * model profile. Used as the baseline catalog before/alongside any live
 * discovery, and as the only catalog for providers that don't implement
 * `listModels`.
 */
export function routesForProviderProfile(providerId: string, modelOverride?: string): ModelRoute[] {
  const profile = profileForProvider(providerId, modelOverride);
  const entries: Array<{ model: string; tier: ProfileTier }> = [];
  if (profile.fastModel) entries.push({ model: profile.fastModel, tier: "fast" });
  entries.push({ model: profile.defaultModel, tier: "default" });
  if (profile.reasoningModel) entries.push({ model: profile.reasoningModel, tier: "reasoning" });

  const seen = new Set<string>();
  const routes: ModelRoute[] = [];
  for (const entry of entries) {
    if (seen.has(entry.model)) continue;
    seen.add(entry.model);
    routes.push({
      id: `${providerId}:${entry.model}`,
      providerId,
      model: entry.model,
      available: true,
      metadata: metadataForModel(entry.model, entry.tier),
    });
  }
  return routes;
}

/**
 * Builds route metadata for a model, preferring real cost/context data from
 * the maintained {@link lookupKnownModelInfo} catalog and falling back to a
 * coarse fast/default/reasoning heuristic rating when the model is unknown
 * (e.g. a local Ollama model, or a hosted model released after this table
 * was last updated).
 */
function metadataForModel(model: string, tier: ProfileTier): ModelRouteMetadata {
  const known = lookupKnownModelInfo(model);
  const heuristic = metadataForTier(tier);
  if (!known) return heuristic;

  const cost = costRatingFromPricing(known) ?? heuristic.cost;
  return {
    ...heuristic,
    cost,
    costSource: costRatingFromPricing(known) !== undefined ? "catalog" : "heuristic",
    ...(known.contextWindowTokens
      ? { contextWindowTokens: known.contextWindowTokens, contextWindowSource: "catalog" }
      : {}),
    ...(known.inputCostPerMillionTokens !== undefined
      ? { inputCostPerMillionTokens: known.inputCostPerMillionTokens }
      : {}),
    ...(known.outputCostPerMillionTokens !== undefined
      ? { outputCostPerMillionTokens: known.outputCostPerMillionTokens }
      : {}),
  };
}

function metadataForTier(tier: ProfileTier): ModelRouteMetadata {
  if (tier === "fast")
    return { cost: 1, speed: 3, intelligence: 1, costSource: "heuristic", tags: ["fast"] };
  if (tier === "reasoning")
    return { cost: 3, speed: 1, intelligence: 3, costSource: "heuristic", tags: ["reasoning"] };
  return { cost: 2, speed: 2, intelligence: 2, costSource: "heuristic", tags: ["default"] };
}

/**
 * Attempts live model discovery through `ProviderAdapter.listModels`.
 * Returns `undefined` (rather than throwing) when the adapter doesn't
 * implement discovery or the call fails, so callers can fall back to static
 * catalog routes without special-casing any one provider.
 *
 * Provider APIs generally don't return pricing/context window, so each
 * discovered model is cross-referenced against the maintained
 * {@link lookupKnownModelInfo} table to fill those fields in when possible;
 * models absent from that table are still returned with `available: true`
 * but without cost/context metadata (surfaced as "discovered" only).
 */
export async function discoverProviderRoutes(
  providerId: string,
  adapter: ProviderAdapter,
  auth: ProviderAuth,
): Promise<ModelRoute[] | undefined> {
  if (!adapter.listModels) return undefined;
  try {
    const models = await adapter.listModels(auth);
    if (models.length === 0) return undefined;
    return models.map((model) => {
      const known = lookupKnownModelInfo(model.id);
      const cost = known ? costRatingFromPricing(known) : undefined;
      return {
        id: `${providerId}:${model.id}`,
        providerId,
        model: model.id,
        available: true,
        metadata: {
          ...(cost !== undefined ? { cost, costSource: "catalog" as const } : {}),
          ...(known?.inputCostPerMillionTokens !== undefined
            ? { inputCostPerMillionTokens: known.inputCostPerMillionTokens }
            : {}),
          ...(known?.outputCostPerMillionTokens !== undefined
            ? { outputCostPerMillionTokens: known.outputCostPerMillionTokens }
            : {}),
          ...(model.contextWindowTokens
            ? {
                contextWindowTokens: model.contextWindowTokens,
                contextWindowSource: "discovered" as const,
              }
            : known?.contextWindowTokens
              ? {
                  contextWindowTokens: known.contextWindowTokens,
                  contextWindowSource: "catalog" as const,
                }
              : {}),
          tags: ["discovered"],
        },
      };
    });
  } catch {
    return undefined;
  }
}

/**
 * Merges discovered (live) routes with static profile routes for the same
 * model, preferring discovered availability while keeping profile-derived
 * cost/speed/intelligence ratings when both describe the same model.
 * Discovered models with no profile match are kept with their own (limited)
 * metadata so newly pulled/available models still show up.
 */
export function mergeProviderRoutes(
  profileRoutes: ModelRoute[],
  discoveredRoutes: ModelRoute[] | undefined,
): ModelRoute[] {
  if (!discoveredRoutes || discoveredRoutes.length === 0) {
    return profileRoutes;
  }

  const byModel = new Map<string, ModelRoute>();
  for (const route of discoveredRoutes) {
    byModel.set(route.model, route);
  }
  for (const route of profileRoutes) {
    const discovered = byModel.get(route.model);
    if (discovered) {
      byModel.set(route.model, {
        ...discovered,
        metadata: { ...discovered.metadata, ...route.metadata },
      });
    } else {
      byModel.set(route.model, route);
    }
  }
  return [...byModel.values()];
}
