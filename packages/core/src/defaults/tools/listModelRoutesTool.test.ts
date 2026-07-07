import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRoute } from "../../model/types";
import { createListModelRoutesTool } from "./listModelRoutesTool";

function makeRoute(
  id: string,
  providerId: string,
  model: string,
  meta: Partial<ModelRoute["metadata"]> = {},
  available = true,
): ModelRoute {
  return { id, providerId, model, available, metadata: meta };
}

const CATALOG: ModelRoute[] = [
  makeRoute("openai:gpt-5.5", "openai", "gpt-5.5", {
    cost: 3,
    speed: 2,
    intelligence: 3,
    tags: ["reasoning"],
    inputCostPerMillionTokens: 5,
    outputCostPerMillionTokens: 30,
    contextWindowTokens: 1_000_000,
    costSource: "catalog",
    contextWindowSource: "catalog",
  }),
  makeRoute("openai:gpt-5.4-mini", "openai", "gpt-5.4-mini", {
    cost: 2,
    speed: 3,
    intelligence: 2,
    tags: ["fast"],
    inputCostPerMillionTokens: 0.75,
    outputCostPerMillionTokens: 4.5,
    contextWindowTokens: 400_000,
    costSource: "catalog",
    contextWindowSource: "catalog",
  }),
  makeRoute("ollama:llama3.1:8b", "ollama", "llama3.1:8b", {
    cost: 1,
    speed: 2,
    intelligence: 1,
    tags: ["fast", "local"],
    costSource: "heuristic",
  }),
];

test("list_model_routes returns all routes when no preference given", async () => {
  const tool = createListModelRoutesTool(() => CATALOG);
  const result = await tool.execute({});
  assert.equal(result.total, 3);
  const ids = (result.routes as Array<{ id: string }>).map((r) => r.id);
  assert.deepEqual(ids, ["openai:gpt-5.5", "openai:gpt-5.4-mini", "ollama:llama3.1:8b"]);
});

test("list_model_routes ranks by cost preference (cheapest first)", async () => {
  const tool = createListModelRoutesTool(() => CATALOG);
  const result = await tool.execute({ preference: "cost" });
  const ids = (result.routes as Array<{ id: string }>).map((r) => r.id);
  // cost scores: ollama=-1, mini=-2, flagship=-3 → ollama wins (least negative)
  assert.equal(ids[0], "ollama:llama3.1:8b");
  assert.equal(ids[2], "openai:gpt-5.5");
});

test("list_model_routes ranks by intelligence preference (most capable first)", async () => {
  const tool = createListModelRoutesTool(() => CATALOG);
  const result = await tool.execute({ preference: "intelligence" });
  const routes = result.routes as Array<{ id: string; intelligence?: number }>;
  assert.equal(routes[0]?.id, "openai:gpt-5.5");
  assert.equal(routes[0]?.intelligence, 3);
});

test("list_model_routes ranks by speed preference (fastest first)", async () => {
  const tool = createListModelRoutesTool(() => CATALOG);
  const result = await tool.execute({ preference: "speed" });
  const routes = result.routes as Array<{ id: string }>;
  assert.equal(routes[0]?.id, "openai:gpt-5.4-mini");
});

test("list_model_routes ignores unknown preference and returns catalog order", async () => {
  const tool = createListModelRoutesTool(() => CATALOG);
  const result = await tool.execute({ preference: "turbo" as never });
  const ids = (result.routes as Array<{ id: string }>).map((r) => r.id);
  assert.deepEqual(ids, ["openai:gpt-5.5", "openai:gpt-5.4-mini", "ollama:llama3.1:8b"]);
});

test("list_model_routes omits undefined metadata fields", async () => {
  const sparse = [makeRoute("ollama:phi4:latest", "ollama", "phi4:latest")];
  const tool = createListModelRoutesTool(() => sparse);
  const result = await tool.execute({});
  const route = (result.routes as Array<Record<string, unknown>>)[0];
  assert.ok(route);
  assert.equal("cost" in route, false);
  assert.equal("speed" in route, false);
  assert.equal("intelligence" in route, false);
  assert.equal("contextWindowTokens" in route, false);
  assert.equal("inputCostPerMillionTokens" in route, false);
  assert.equal("tags" in route, false);
  // `available` is no longer exposed — all returned routes are available.
  assert.equal("available" in route, false);
  // Required fields are always present.
  assert.equal(route.id, "ollama:phi4:latest");
  assert.equal(route.providerId, "ollama");
  assert.equal(route.model, "phi4:latest");
});

test("list_model_routes returns empty array when catalog is empty", async () => {
  const tool = createListModelRoutesTool(() => []);
  const result = await tool.execute({});
  assert.equal(result.total, 0);
  assert.deepEqual(result.routes, []);
});

test("list_model_routes excludes unavailable routes entirely", async () => {
  const routes = [
    makeRoute("openai:gpt-5.5", "openai", "gpt-5.5", {}, false),
    makeRoute("openai:gpt-5.4-mini", "openai", "gpt-5.4-mini", {}, true),
  ];
  const tool = createListModelRoutesTool(() => routes);
  const result = await tool.execute({});
  // Only the available route is returned.
  assert.equal(result.total, 1);
  const ids = (result.routes as Array<{ id: string }>).map((r) => r.id);
  assert.deepEqual(ids, ["openai:gpt-5.4-mini"]);
});

test("list_model_routes excludes unavailable routes even with preference", async () => {
  const routes = [
    // Cheapest but unavailable.
    makeRoute(
      "ollama:llama3.1:8b",
      "ollama",
      "llama3.1:8b",
      { cost: 1, speed: 2, intelligence: 1 },
      false,
    ),
    // More expensive but available.
    makeRoute(
      "openai:gpt-5.4-mini",
      "openai",
      "gpt-5.4-mini",
      { cost: 2, speed: 3, intelligence: 2 },
      true,
    ),
  ];
  const tool = createListModelRoutesTool(() => routes);
  const result = await tool.execute({ preference: "cost" });
  // Unavailable route is filtered out; only the available one is returned.
  assert.equal(result.total, 1);
  const ids = (result.routes as Array<{ id: string }>).map((r) => r.id);
  assert.deepEqual(ids, ["openai:gpt-5.4-mini"]);
});

test("list_model_routes includes real pricing and context window when known", async () => {
  const tool = createListModelRoutesTool(() => CATALOG);
  const result = await tool.execute({});
  const flagship = (result.routes as Array<Record<string, unknown>>).find(
    (r) => r.id === "openai:gpt-5.5",
  );
  assert.ok(flagship);
  assert.equal(flagship.inputCostPerMillionTokens, 5);
  assert.equal(flagship.outputCostPerMillionTokens, 30);
  assert.equal(flagship.contextWindowTokens, 1_000_000);
  assert.equal(flagship.costSource, "catalog");
  assert.equal(flagship.contextWindowSource, "catalog");
});
