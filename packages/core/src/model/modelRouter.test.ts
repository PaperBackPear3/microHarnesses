import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError } from "../shared/errors";
import { DefaultModelRouter } from "./modelRouter";
import type { ModelRoute } from "./types";

const routes: ModelRoute[] = [
  {
    id: "openai:gpt-4.1-mini",
    providerId: "openai",
    model: "gpt-4.1-mini",
    metadata: { cost: 1, speed: 3, intelligence: 1, tags: ["fast"] },
  },
  {
    id: "openai:gpt-4.1",
    providerId: "openai",
    model: "gpt-4.1",
    metadata: { cost: 2, speed: 2, intelligence: 2, tags: ["default"] },
  },
  {
    id: "openai:o4-mini",
    providerId: "openai",
    model: "o4-mini",
    metadata: { cost: 3, speed: 1, intelligence: 3, tags: ["reasoning"] },
  },
];

test("throws when no candidate routes are provided", () => {
  const router = new DefaultModelRouter();
  assert.throws(() => router.selectRoute({}, []), ConfigError);
});

test("cost preference selects the cheapest route", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute({ preference: "cost" }, routes);
  assert.equal(decision.route.model, "gpt-4.1-mini");
  assert.equal(decision.preference, "cost");
});

test("speed preference selects the fastest route", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute({ preference: "speed" }, routes);
  assert.equal(decision.route.model, "gpt-4.1-mini");
});

test("intelligence preference selects the most capable route", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute({ preference: "intelligence" }, routes);
  assert.equal(decision.route.model, "o4-mini");
});

test("balanced preference weighs intelligence, speed, and cost", () => {
  const router = new DefaultModelRouter();
  // Non-collinear metadata: the "default" route offers a genuinely strong
  // trade-off (decent cost/speed, above-average intelligence) rather than a
  // pure midpoint, so a linear balanced score can uniquely prefer it.
  const balancedRoutes: ModelRoute[] = [
    {
      id: "openai:gpt-4.1-mini",
      providerId: "openai",
      model: "gpt-4.1-mini",
      metadata: { cost: 1, speed: 3, intelligence: 1 },
    },
    {
      id: "openai:gpt-4.1",
      providerId: "openai",
      model: "gpt-4.1",
      metadata: { cost: 1.5, speed: 2, intelligence: 2.5 },
    },
    {
      id: "openai:o4-mini",
      providerId: "openai",
      model: "o4-mini",
      metadata: { cost: 3, speed: 1, intelligence: 3 },
    },
  ];
  const decision = router.selectRoute({ preference: "balanced" }, balancedRoutes);
  assert.equal(decision.route.model, "gpt-4.1");
});

test("auto infers intelligence preference from high effort", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute({ preference: "auto", effort: "high" }, routes);
  assert.equal(decision.route.model, "o4-mini");
  assert.equal(decision.preference, "intelligence");
});

test("auto infers speed preference from fast task type", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute({ preference: "auto", taskType: "fast" }, routes);
  assert.equal(decision.route.model, "gpt-4.1-mini");
  assert.equal(decision.preference, "speed");
});

test("auto falls back to balanced when no hints are given", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute({}, routes);
  assert.equal(decision.preference, "balanced");
});

test("explicit route id override wins regardless of preference", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute(
    { preference: "cost", overrideRouteId: "openai:o4-mini" },
    routes,
  );
  assert.equal(decision.route.model, "o4-mini");
  assert.equal(decision.reason, "override");
});

test("explicit provider+model override wins regardless of preference", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute(
    { preference: "speed", overrideProviderId: "openai", overrideModel: "o4-mini" },
    routes,
  );
  assert.equal(decision.route.model, "o4-mini");
  assert.equal(decision.reason, "override");
});

test("provider+model override not in catalog is honored as a synthetic route", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute(
    { preference: "cost", overrideProviderId: "openai", overrideModel: "gpt-custom-finetune" },
    routes,
  );
  assert.equal(decision.route.providerId, "openai");
  assert.equal(decision.route.model, "gpt-custom-finetune");
  assert.equal(decision.reason, "override");
});

test("unavailable routes are excluded unless all routes are unavailable", () => {
  const router = new DefaultModelRouter();
  const withUnavailable: ModelRoute[] = [
    { ...routes[1], available: false },
    routes[2] as ModelRoute,
  ];
  const decision = router.selectRoute({ preference: "cost" }, withUnavailable);
  assert.equal(decision.route.model, "o4-mini");
});

test("falls back to full pool when every route is unavailable", () => {
  const router = new DefaultModelRouter();
  const allUnavailable = routes.map((route) => ({ ...route, available: false }));
  const decision = router.selectRoute({ preference: "cost" }, allUnavailable);
  assert.equal(decision.route.model, "gpt-4.1-mini");
});

test("requiredTags constraint filters candidates when satisfiable", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute(
    { preference: "cost", constraints: { requiredTags: ["reasoning"] } },
    routes,
  );
  assert.equal(decision.route.model, "o4-mini");
  assert.equal(decision.reason, "constraint");
});

test("minIntelligence constraint filters out weaker routes", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute(
    { preference: "cost", constraints: { minIntelligence: 2 } },
    routes,
  );
  assert.equal(decision.route.model, "gpt-4.1");
});

test("maxCost constraint filters out expensive routes", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute(
    { preference: "intelligence", constraints: { maxCost: 2 } },
    routes,
  );
  assert.equal(decision.route.model, "gpt-4.1");
});

test("unsatisfiable constraints fall back to the unconstrained pool", () => {
  const router = new DefaultModelRouter();
  const decision = router.selectRoute(
    { preference: "cost", constraints: { minIntelligence: 99 } },
    routes,
  );
  assert.equal(decision.route.model, "gpt-4.1-mini");
  assert.equal(decision.reason, "preference");
});
