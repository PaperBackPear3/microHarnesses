import assert from "node:assert/strict";
import { test } from "node:test";
import { ModeController } from "./modes";

test("mode controller cycles in expected order", () => {
  const mode = new ModeController("plan");
  assert.equal(mode.cycle(), "accept-edits");
  assert.equal(mode.cycle(), "autopilot");
  assert.equal(mode.cycle(), "plan");
});
