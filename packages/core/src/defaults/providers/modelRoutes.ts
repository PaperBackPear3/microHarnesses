import type { ModelRoute, ModelRouteMetadata } from "../../model/types";
import type { ProviderAdapter, ProviderAuth } from "../../providers/types";
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
      metadata: metadataForTier(entry.tier),
    });
  }
  return routes;
}

function metadataForTier(tier: ProfileTier): ModelRouteMetadata {
  if (tier === "fast") return { cost: 1, speed: 3, intelligence: 1, tags: ["fast"] };
  if (tier === "reasoning") return { cost: 3, speed: 1, intelligence: 3, tags: ["reasoning"] };
  return { cost: 2, speed: 2, intelligence: 2, tags: ["default"] };
}

/**
 * Attempts live model discovery through `ProviderAdapter.listModels`.
 * Returns `undefined` (rather than throwing) when the adapter doesn't
 * implement discovery or the call fails, so callers can fall back to static
 * catalog routes without special-casing any one provider.
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
    return models.map((model) => ({
      id: `${providerId}:${model.id}`,
      providerId,
      model: model.id,
      available: true,
      metadata: {
        ...(model.contextWindowTokens ? { contextWindowTokens: model.contextWindowTokens } : {}),
        tags: ["discovered"],
      },
    }));
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
