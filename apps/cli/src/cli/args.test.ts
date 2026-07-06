import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGlobalCliArgs, parseSessionsArgs } from "./args";

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
  ]);
  assert.equal(parsed.prompt, "hello");
  assert.equal(parsed.mode, "autopilot");
  assert.equal(parsed.effort, "high");
  assert.equal(parsed.model, "gpt-4.1");
});

test("parseSessionsArgs handles show subcommand", () => {
  const parsed = parseSessionsArgs(["show", "s-123"]);
  assert.equal(parsed.sub, "show");
  assert.equal(parsed.sessionId, "s-123");
});
