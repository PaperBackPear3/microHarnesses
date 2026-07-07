import assert from "node:assert/strict";
import test from "node:test";
import { costRatingFromPricing, lookupKnownModelInfo } from "./modelCatalog";

test("lookupKnownModelInfo resolves known OpenAI models by exact prefix", () => {
  const info = lookupKnownModelInfo("gpt-5.4-mini");
  assert.ok(info);
  assert.equal(info?.contextWindowTokens, 400_000);
  assert.equal(info?.inputCostPerMillionTokens, 0.75);
  assert.equal(info?.outputCostPerMillionTokens, 4.5);
});

test("lookupKnownModelInfo resolves dated/suffixed snapshot ids via longest prefix match", () => {
  const info = lookupKnownModelInfo("claude-sonnet-5-20260630");
  assert.ok(info);
  assert.equal(info?.contextWindowTokens, 1_000_000);
});

test("lookupKnownModelInfo picks the longest matching prefix, not the first", () => {
  // "gpt-5.4-mini" and "gpt-5.4" are both prefixes of "gpt-5.4-mini-2026-03-17";
  // the longer, more specific prefix should win.
  const info = lookupKnownModelInfo("gpt-5.4-mini-2026-03-17");
  assert.equal(info?.inputCostPerMillionTokens, 0.75);
});

test("lookupKnownModelInfo returns undefined for unlisted/local models", () => {
  assert.equal(lookupKnownModelInfo("llama3.1:8b"), undefined);
  assert.equal(lookupKnownModelInfo("some-brand-new-model"), undefined);
});

test("lookupKnownModelInfo returns undefined for models older than the freshness window", () => {
  // These were removed from the catalog for being older than ~365 days as of
  // 2026-07-07 (the previous generation, e.g. gpt-4.1/claude-sonnet-4 family).
  assert.equal(lookupKnownModelInfo("gpt-4.1-mini"), undefined);
  assert.equal(lookupKnownModelInfo("gpt-4o"), undefined);
  assert.equal(lookupKnownModelInfo("o4-mini"), undefined);
  assert.equal(lookupKnownModelInfo("claude-sonnet-4-5"), undefined);
  assert.equal(lookupKnownModelInfo("claude-3-5-haiku-latest"), undefined);
});

test("lookupKnownModelInfo resolves current-generation OpenAI models (gpt-5.x)", () => {
  const flagship = lookupKnownModelInfo("gpt-5.5");
  assert.equal(flagship?.contextWindowTokens, 1_000_000);
  assert.equal(flagship?.inputCostPerMillionTokens, 5);
  assert.equal(flagship?.outputCostPerMillionTokens, 30);

  const mini = lookupKnownModelInfo("gpt-5.4-mini");
  assert.equal(mini?.inputCostPerMillionTokens, 0.75);
  assert.equal(mini?.outputCostPerMillionTokens, 4.5);

  // "gpt-5.4-mini" and "gpt-5.4" share a prefix; the more specific one wins.
  const nano = lookupKnownModelInfo("gpt-5.4-nano");
  assert.equal(nano?.inputCostPerMillionTokens, 0.2);
});

test("lookupKnownModelInfo resolves current-generation Anthropic models (claude 4.6+/5)", () => {
  const opus = lookupKnownModelInfo("claude-opus-4-8");
  assert.equal(opus?.contextWindowTokens, 1_000_000);
  assert.equal(opus?.inputCostPerMillionTokens, 5);
  assert.equal(opus?.outputCostPerMillionTokens, 25);

  const sonnet5 = lookupKnownModelInfo("claude-sonnet-5-20260601");
  assert.equal(sonnet5?.inputCostPerMillionTokens, 2);

  const haiku = lookupKnownModelInfo("claude-haiku-4-5");
  assert.equal(haiku?.inputCostPerMillionTokens, 1);
});

test("costRatingFromPricing buckets cheap models as 1", () => {
  const rating = costRatingFromPricing({
    inputCostPerMillionTokens: 0.2,
    outputCostPerMillionTokens: 1.25,
  });
  assert.equal(rating, 1);
});

test("costRatingFromPricing buckets flagship models as 3", () => {
  const rating = costRatingFromPricing({
    inputCostPerMillionTokens: 5,
    outputCostPerMillionTokens: 30,
  });
  assert.equal(rating, 3);
});

test("costRatingFromPricing buckets mid-tier models as 2", () => {
  const rating = costRatingFromPricing({
    inputCostPerMillionTokens: 1,
    outputCostPerMillionTokens: 5,
  });
  assert.equal(rating, 2);
});

test("costRatingFromPricing returns undefined when no pricing is known", () => {
  assert.equal(costRatingFromPricing({}), undefined);
});
