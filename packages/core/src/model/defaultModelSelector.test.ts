import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError } from "../shared/errors";
import { DefaultModelSelector } from "./defaultModelSelector";
import type { ModelProfile } from "./types";

const base = { agentName: "a", iteration: 1 };

test("override wins over everything", () => {
  const selector = new DefaultModelSelector();
  const profile: ModelProfile = { defaultModel: "default", reasoningModel: "r", fastModel: "f" };
  const decision = selector.select(
    { ...base, overrideModel: "override", promptHintModel: "hint", taskType: "reasoning" },
    profile,
  );
  assert.equal(decision.model, "override");
  assert.equal(decision.reason, "override");
});

test("prompt-hint wins over profile defaults", () => {
  const selector = new DefaultModelSelector();
  const decision = selector.select(
    { ...base, promptHintModel: "hint", taskType: "reasoning" },
    { defaultModel: "d", reasoningModel: "r" },
  );
  assert.equal(decision.model, "hint");
  assert.equal(decision.reason, "prompt-hint");
});

test("reasoning task uses profile.reasoningModel when set", () => {
  const selector = new DefaultModelSelector();
  const decision = selector.select(
    { ...base, taskType: "reasoning" },
    { defaultModel: "d", reasoningModel: "r" },
  );
  assert.equal(decision.model, "r");
});

test("fast task uses profile.fastModel when set", () => {
  const selector = new DefaultModelSelector();
  const decision = selector.select(
    { ...base, taskType: "fast" },
    { defaultModel: "d", fastModel: "f" },
  );
  assert.equal(decision.model, "f");
});

test("falls back to defaultModel when taskType-specific model missing", () => {
  const selector = new DefaultModelSelector();
  const decision = selector.select({ ...base, taskType: "reasoning" }, { defaultModel: "d" });
  assert.equal(decision.model, "d");
});

test("throws ConfigError when no model can be resolved", () => {
  const selector = new DefaultModelSelector();
  assert.throws(() => selector.select({ ...base }, {} as ModelProfile), ConfigError);
});
