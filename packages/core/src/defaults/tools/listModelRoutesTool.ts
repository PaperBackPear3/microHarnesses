import { scoreRoute } from "../../model/modelRouter";
import type { ModelRoute, ModelRoutingPreference } from "../../model/types";
import type { ToolDefinition } from "../../tools/types";

const ROUTING_PREFERENCES = ["cost", "speed", "intelligence", "balanced", "auto"] as const;

/** Serialisable summary of a single `ModelRoute`. Undefined fields are omitted. */
export interface ModelRouteSummary {
  id: string;
  providerId: string;
  model: string;
  available: boolean;
  tags?: string[];
  /** Relative cost tier (1 = cheapest, 3 = most expensive). */
  cost?: number;
  /** Relative speed tier (1 = slowest, 3 = fastest). */
  speed?: number;
  /** Relative intelligence/capability tier (1 = least capable, 3 = most capable). */
  intelligence?: number;
  contextWindowTokens?: number;
  /** USD list price per 1M input tokens (when known from catalog). */
  inputCostPerMillionTokens?: number;
  /** USD list price per 1M output tokens (when known from catalog). */
  outputCostPerMillionTokens?: number;
  costSource?: "catalog" | "heuristic";
  contextWindowSource?: "discovered" | "catalog" | "heuristic";
}

function toSummary(route: ModelRoute): ModelRouteSummary {
  const m = route.metadata;
  return {
    id: route.id,
    providerId: route.providerId,
    model: route.model,
    available: route.available !== false,
    ...(m?.tags?.length ? { tags: m.tags } : {}),
    ...(m?.cost !== undefined ? { cost: m.cost } : {}),
    ...(m?.speed !== undefined ? { speed: m.speed } : {}),
    ...(m?.intelligence !== undefined ? { intelligence: m.intelligence } : {}),
    ...(m?.contextWindowTokens !== undefined ? { contextWindowTokens: m.contextWindowTokens } : {}),
    ...(m?.inputCostPerMillionTokens !== undefined
      ? { inputCostPerMillionTokens: m.inputCostPerMillionTokens }
      : {}),
    ...(m?.outputCostPerMillionTokens !== undefined
      ? { outputCostPerMillionTokens: m.outputCostPerMillionTokens }
      : {}),
    ...(m?.costSource !== undefined ? { costSource: m.costSource } : {}),
    ...(m?.contextWindowSource !== undefined ? { contextWindowSource: m.contextWindowSource } : {}),
  };
}

/**
 * Creates a `list_model_routes` tool that returns the current route catalog so
 * models can make informed routing decisions (e.g. pick the cheapest or most
 * capable available model before spawning a subagent).
 *
 * The tool reads the in-memory snapshot returned by `routeCatalog` — the same
 * data used by `DefaultModelRouter` and the CLI `/model` listing. It is
 * synchronous and non-blocking; if Ollama discovery is still running the
 * snapshot may be slightly stale until the next `refreshModelRoutes()` fires.
 */
export function createListModelRoutesTool(routeCatalog: () => ModelRoute[]): ToolDefinition {
  return {
    name: "list_model_routes",
    description:
      "Returns the current catalog of available model routes across all configured providers. " +
      "Use this before spawning a subagent when you need to pick a model based on cost, speed, " +
      "intelligence, or availability. Each route includes provider, model id, relative ratings " +
      "(cost/speed/intelligence 1-3), real pricing when known, and context window size. " +
      "Pass 'preference' to get routes pre-ranked for a specific dimension.",
    risk: "low",
    capabilities: [],
    tags: ["model", "routing", "discovery"],
    inputSchema: {
      type: "object",
      properties: {
        preference: {
          type: "string",
          enum: [...ROUTING_PREFERENCES],
          description:
            "Optional ranking preference. When given, routes are sorted best-first for that " +
            "dimension (cost=cheapest first, speed=fastest first, intelligence=most capable first, " +
            "balanced/auto=weighted blend). Omit to get routes in catalog order.",
        },
      },
      additionalProperties: false,
    },
    execute(input) {
      const routes = routeCatalog();

      const rawPref = typeof input.preference === "string" ? input.preference : undefined;
      const preference =
        rawPref && (ROUTING_PREFERENCES as readonly string[]).includes(rawPref)
          ? (rawPref as ModelRoutingPreference)
          : undefined;

      // Zip routes with their summaries so sorting never needs a re-lookup.
      const paired = routes.map((route) => ({ route, summary: toSummary(route) }));

      paired.sort((a, b) => {
        // Always surface available routes before unavailable ones, regardless
        // of preference score — an agent trusting sort order should not be
        // directed to a dead route.
        const aAvail = a.route.available !== false ? 1 : 0;
        const bAvail = b.route.available !== false ? 1 : 0;
        if (aAvail !== bAvail) return bAvail - aAvail;
        if (!preference) return 0;
        return scoreRoute(b.route, preference) - scoreRoute(a.route, preference);
      });

      const summaries = paired.map((p) => p.summary);
      return Promise.resolve({ routes: summaries, total: summaries.length });
    },
  };
}
