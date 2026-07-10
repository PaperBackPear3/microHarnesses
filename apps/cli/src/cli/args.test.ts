import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGlobalCliArgs, parseSessionsArgs } from "./args.js";

test("parseGlobalCliArgs parses mode and effort", () => {
  const parsed = parseGlobalCliArgs([
    "-p",
    "hello",
    "--mode",
    "autopilot",
    "--effort",
    "high",
    "--model",
    "gpt-4.1",
    "--compaction-trigger",
    "0.9",
    "--compaction-target",
    "0.72",
    "--turn-compaction-target",
    "0.8",
    "--non-turn-token-reserve",
    "2500",
  ]);
  assert.equal(parsed.prompt, "hello");
  assert.equal(parsed.mode, "autopilot");
  assert.equal(parsed.effort, "high");
  assert.equal(parsed.model, "gpt-4.1");
  assert.equal(parsed.compactionTriggerUtilization, 0.9);
  assert.equal(parsed.compactionTargetUtilization, 0.72);
  assert.equal(parsed.turnCompactionTargetRatio, 0.8);
  assert.equal(parsed.nonTurnTokenReserve, 2500);
  assert.equal(parsed.maxIterations, undefined);
});

test("parseGlobalCliArgs accepts unlimited iterations", () => {
  const parsed = parseGlobalCliArgs(["--iterations", "unlimited"]);
  assert.equal(parsed.maxIterations, "unlimited");
});

test("parseGlobalCliArgs parses routing preference", () => {
  const parsed = parseGlobalCliArgs(["--routing-preference", "cost"]);
  assert.equal(parsed.routingPreference, "cost");
});

test("parseGlobalCliArgs parses state-machine flags", () => {
  const parsed = parseGlobalCliArgs([
    "--state-machine",
    "strict",
    "--state-machine-profile",
    "focused-delivery",
  ]);
  assert.equal(parsed.stateMachineEnforcement, "strict");
  assert.equal(parsed.stateMachineProfile, "focused-delivery");
});

test("parseGlobalCliArgs ignores an unknown routing preference", () => {
  const parsed = parseGlobalCliArgs(["--routing-preference", "nonsense"]);
  assert.equal(parsed.routingPreference, undefined);
});

test("parseSessionsArgs handles show subcommand", () => {
  const parsed = parseSessionsArgs(["show", "s-123"]);
  assert.equal(parsed.sub, "show");
  assert.equal(parsed.sessionId, "s-123");
});

test("parseGlobalCliArgs keeps compatibility aliases but prefers canonical flags", () => {
  const parsed = parseGlobalCliArgs([
    "-p",
    "from-short",
    "--print",
    "from-long",
    "--session",
    "legacy-session",
    "--session-id",
    "canonical-session",
  ]);
  assert.equal(parsed.prompt, "from-long");
  assert.equal(parsed.sessionId, "canonical-session");
});
