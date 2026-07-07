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
    ["gpt-4.1-mini", "gpt-4.1", "o4-mini"],
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
