import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderAdapter, ProviderAuth } from "../../providers/types";
import {
  discoverProviderRoutes,
  mergeProviderRoutes,
  routesForProviderProfile,
} from "./modelRoutes";

test("routesForProviderProfile builds fast/default/reasoning routes for openai", () => {
  const routes = routesForProviderProfile("openai");
  assert.deepEqual(
    routes.map((r) => r.model),
    ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"],
  );
  assert.equal(routes[0]?.metadata?.tags?.[0], "fast");
  assert.equal(routes[2]?.metadata?.tags?.[0], "reasoning");
  assert.equal(
    routes.every((r) => r.providerId === "openai"),
    true,
  );
});

test("routesForProviderProfile collapses to a single route when overridden", () => {
  const routes = routesForProviderProfile("openai", "custom-model");
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.model, "custom-model");
});

test("routesForProviderProfile dedupes identical fast/default/reasoning models", () => {
  const routes = routesForProviderProfile("ollama");
  const models = routes.map((r) => r.model);
  assert.equal(new Set(models).size, models.length);
});

test("discoverProviderRoutes returns undefined when listModels is not implemented", async () => {
  const adapter: ProviderAdapter = {
    providerId: "custom",
    async complete() {
      throw new Error("not used");
    },
  };
  const result = await discoverProviderRoutes("custom", adapter, { apiKey: "x" });
  assert.equal(result, undefined);
});

test("discoverProviderRoutes returns undefined when listModels throws", async () => {
  const adapter: ProviderAdapter = {
    providerId: "custom",
    async complete() {
      throw new Error("not used");
    },
    async listModels() {
      throw new Error("server unreachable");
    },
  };
  const result = await discoverProviderRoutes("custom", adapter, { apiKey: "x" });
  assert.equal(result, undefined);
});

test("routesForProviderProfile fills real cost/context metadata for catalog-known openai models", () => {
  // modelProfiles.ts's openai defaults (gpt-5.4-mini/gpt-5.4/gpt-5.5) are
  // current-generation and present in the catalog, so this exercises the
  // catalog-hit path directly against the real built-in defaults.
  const routes = routesForProviderProfile("openai");
  const mini = routes.find((r) => r.model === "gpt-5.4-mini");
  assert.equal(mini?.metadata?.costSource, "catalog");
  assert.equal(mini?.metadata?.contextWindowSource, "catalog");
  assert.equal(mini?.metadata?.contextWindowTokens, 400_000);
  assert.equal(mini?.metadata?.inputCostPerMillionTokens, 0.75);
  assert.equal(mini?.metadata?.outputCostPerMillionTokens, 4.5);
  // Mid tier should score as the middle relative bucket.
  assert.equal(mini?.metadata?.cost, 2);
});

test("routesForProviderProfile falls back to heuristic metadata once a model ages out of the catalog", () => {
  // Simulates a model no longer in the 365-day freshness window (e.g. a
  // deployment still pinned to a superseded id via an explicit override).
  // It should fall back to heuristic tier ratings rather than keeping stale
  // pricing/context data.
  const routes = routesForProviderProfile("openai", "gpt-4.1-mini");
  assert.equal(routes[0]?.metadata?.costSource, "heuristic");
  assert.equal(routes[0]?.metadata?.contextWindowTokens, undefined);
});

test("routesForProviderProfile falls back to heuristic metadata for unknown/local models", () => {
  const routes = routesForProviderProfile("ollama");
  for (const route of routes) {
    assert.equal(route.metadata?.costSource, "heuristic");
    assert.equal(route.metadata?.contextWindowTokens, undefined);
  }
});

test("discoverProviderRoutes maps discovered models to routes", async () => {
  const adapter: ProviderAdapter = {
    providerId: "ollama",
    async complete() {
      throw new Error("not used");
    },
    async listModels(_auth: ProviderAuth) {
      return [{ id: "llama3.1:8b" }, { id: "llama3.1:70b" }];
    },
  };
  const result = await discoverProviderRoutes("ollama", adapter, { apiKey: "ollama" });
  assert.deepEqual(
    result?.map((r) => r.model),
    ["llama3.1:8b", "llama3.1:70b"],
  );
  assert.equal(result?.[0]?.id, "ollama:llama3.1:8b");
  assert.equal(result?.[0]?.metadata?.tags?.[0], "discovered");
});

test("discoverProviderRoutes cross-references the catalog for known hosted models", async () => {
  const adapter: ProviderAdapter = {
    providerId: "openai",
    async complete() {
      throw new Error("not used");
    },
    async listModels(_auth: ProviderAuth) {
      return [{ id: "gpt-5.4" }];
    },
  };
  const result = await discoverProviderRoutes("openai", adapter, { apiKey: "x" });
  assert.equal(result?.[0]?.metadata?.costSource, "catalog");
  assert.equal(result?.[0]?.metadata?.contextWindowSource, "catalog");
  assert.equal(result?.[0]?.metadata?.contextWindowTokens, 1_000_000);
});

test("mergeProviderRoutes keeps profile metadata for matching discovered models", () => {
  const profileRoutes = routesForProviderProfile("ollama");
  const discovered = profileRoutes.map((r) => ({
    ...r,
    metadata: { tags: ["discovered"] },
  }));
  const merged = mergeProviderRoutes(profileRoutes, discovered);
  for (const route of merged) {
    const original = profileRoutes.find((r) => r.model === route.model);
    assert.equal(route.metadata?.cost, original?.metadata?.cost);
  }
});

test("mergeProviderRoutes keeps discovered-only models not in the profile", () => {
  const profileRoutes = routesForProviderProfile("ollama");
  const discovered = [
    ...profileRoutes,
    {
      id: "ollama:mistral:7b",
      providerId: "ollama",
      model: "mistral:7b",
      available: true,
      metadata: { tags: ["discovered"] },
    },
  ];
  const merged = mergeProviderRoutes(profileRoutes, discovered);
  assert.equal(
    merged.some((r) => r.model === "mistral:7b"),
    true,
  );
});

test("mergeProviderRoutes returns profile routes unchanged when discovery is undefined", () => {
  const profileRoutes = routesForProviderProfile("openai");
  const merged = mergeProviderRoutes(profileRoutes, undefined);
  assert.equal(merged, profileRoutes);
});
