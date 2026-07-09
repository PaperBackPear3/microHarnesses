import assert from "node:assert/strict";
import { test } from "node:test";
import { modeExecutionContract, withModeExecutionContract } from "./modes";

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

test("modeExecutionContract returns autopilot contract only in autopilot mode", () => {
  const contract = modeExecutionContract("autopilot");
  assert.equal(modeExecutionContract("plan"), undefined);
  assert.equal(modeExecutionContract("accept-edits"), undefined);
  assert.ok(contract);
  assert.match(contract, /Autopilot contract:/);
});

test("empty prompt remains unchanged in autopilot mode", () => {
  assert.equal(withModeExecutionContract("   ", "autopilot"), "   ");
});
