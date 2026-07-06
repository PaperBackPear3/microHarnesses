import assert from "node:assert/strict";
import { test } from "node:test";
import { withModeExecutionContract } from "./autopilotPrompt";

test("non-autopilot mode keeps prompt unchanged", () => {
  const prompt = "list apps/cli/src/app";
  assert.equal(withModeExecutionContract(prompt, "accept-edits"), prompt);
  assert.equal(withModeExecutionContract(prompt, "plan"), prompt);
});

test("autopilot mode appends execution contract", () => {
  const prompt = "List apps/cli/src/app";
  const result = withModeExecutionContract(prompt, "autopilot");
  assert.ok(result.startsWith(prompt));
  assert.match(result, /Autopilot contract:/);
  assert.match(result, /Continue autonomously/);
  assert.match(result, /path exploration requests/);
  assert.match(result, /only say the listing is truncated when `truncated: true`/);
});

test("empty prompt remains unchanged in autopilot mode", () => {
  assert.equal(withModeExecutionContract("   ", "autopilot"), "   ");
});
