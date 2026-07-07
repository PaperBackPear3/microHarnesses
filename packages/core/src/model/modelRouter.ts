import { ConfigError } from "../shared/errors";
import type {
  ModelRoute,
  ModelRouteDecision,
  ModelRouter,
  ModelRoutingPreference,
  ModelRoutingRequest,
} from "./types";

/**
 * Deterministic router that filters an explicit route catalog by
 * availability/constraints, then scores the remainder by a routing
 * preference (cost, speed, intelligence, or a balanced blend). `"auto"`
 * infers a preference from task type/effort so callers don't have to
 * classify every request themselves.
 */
export class DefaultModelRouter implements ModelRouter {
  selectRoute(request: ModelRoutingRequest, routes: ModelRoute[]): ModelRouteDecision {
    if (routes.length === 0) {
      throw new ConfigError("DefaultModelRouter requires at least one candidate route");
    }

    const overridden = findOverride(request, routes);
    if (overridden) {
      return { route: overridden, reason: "override", preference: request.preference };
    }
    if (request.overrideProviderId && request.overrideModel) {
      // Explicit provider+model override that isn't in the catalog (e.g. a
      // custom/unlisted model name) is still honored as a synthetic route:
      // routing preferences must never silently override explicit intent.
      return {
        route: {
          id: `${request.overrideProviderId}:${request.overrideModel}`,
          providerId: request.overrideProviderId,
          model: request.overrideModel,
        },
        reason: "override",
        preference: request.preference,
      };
    }

    const available = routes.filter((route) => route.available !== false);
    const candidatePool = available.length > 0 ? available : routes;

    const constrained = applyConstraints(candidatePool, request);
    const candidates = constrained.length > 0 ? constrained : candidatePool;

    const preference = resolvePreference(request);
    const scored = candidates
      .map((route) => ({ route, score: scoreRoute(route, preference) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) {
      throw new ConfigError("DefaultModelRouter found no usable route after filtering");
    }

    return {
      route: best.route,
      reason: constrained.length < candidatePool.length ? "constraint" : "preference",
      preference,
      candidatesConsidered: candidates.length,
    };
  }
}

function findOverride(request: ModelRoutingRequest, routes: ModelRoute[]): ModelRoute | undefined {
  if (request.overrideRouteId) {
    const route = routes.find((r) => r.id === request.overrideRouteId);
    if (route) return route;
  }
  if (request.overrideProviderId && request.overrideModel) {
    const route = routes.find(
      (r) => r.providerId === request.overrideProviderId && r.model === request.overrideModel,
    );
    if (route) return route;
  }
  return undefined;
}

function applyConstraints(routes: ModelRoute[], request: ModelRoutingRequest): ModelRoute[] {
  const constraints = request.constraints;
  if (!constraints) return routes;

  let candidates = routes;

  if (constraints.requiredTags && constraints.requiredTags.length > 0) {
    const tagged = candidates.filter((route) =>
      constraints.requiredTags?.every((tag) => route.metadata?.tags?.includes(tag)),
    );
    if (tagged.length > 0) candidates = tagged;
  }

  if (typeof constraints.minIntelligence === "number") {
    const filtered = candidates.filter(
      (route) => (route.metadata?.intelligence ?? 0) >= (constraints.minIntelligence as number),
    );
    if (filtered.length > 0) candidates = filtered;
  }

  if (typeof constraints.maxCost === "number") {
    const filtered = candidates.filter(
      (route) =>
        (route.metadata?.cost ?? Number.POSITIVE_INFINITY) <= (constraints.maxCost as number),
    );
    if (filtered.length > 0) candidates = filtered;
  }

  return candidates;
}

function resolvePreference(request: ModelRoutingRequest): ModelRoutingPreference {
  if (request.preference && request.preference !== "auto") {
    return request.preference;
  }
  if (request.effort === "high" || request.taskType === "reasoning") {
    return "intelligence";
  }
  if (request.effort === "low" || request.taskType === "fast") {
    return "speed";
  }
  return "balanced";
}

function scoreRoute(route: ModelRoute, preference: ModelRoutingPreference): number {
  const cost = route.metadata?.cost ?? 2;
  const speed = route.metadata?.speed ?? 2;
  const intelligence = route.metadata?.intelligence ?? 2;

  if (preference === "cost") return -cost;
  if (preference === "speed") return speed;
  if (preference === "intelligence") return intelligence;
  // Balanced: favor capability and speed, penalize cost.
  return intelligence * 1.0 + speed * 0.75 - cost * 0.5;
}

/** Parses a `--routing-preference`/`/route` argument into a `ModelRoutingPreference`. */
export function parseModelRoutingPreference(
  value: string | undefined,
): ModelRoutingPreference | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "cost" ||
    normalized === "speed" ||
    normalized === "intelligence" ||
    normalized === "balanced"
  ) {
    return normalized;
  }
  return undefined;
}
