import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCopyPayload, buildScrollbarRail, computeLayoutRowBudget } from "./App.js";

test("layout row budget uses full terminal rows in expanded mode", () => {
  const budget = computeLayoutRowBudget(30, 3);
  assert.equal(budget.viewportHeight, 30);
  assert.equal(budget.footerRows, 6);
  assert.equal(budget.controlRows, 12);
  assert.equal(budget.contentRows, 18);
  assert.equal(budget.transcriptRows, 16);
});

test("layout row budget keeps transcript visible on short terminals", () => {
  const budget = computeLayoutRowBudget(8, 6);
  assert.equal(budget.viewportHeight, 8);
  assert.equal(budget.footerRows, 2);
  assert.equal(budget.contentRows, 1);
  assert.equal(budget.transcriptRows, 1);
});

test("layout row budget accounts for max composer rows", () => {
  const budget = computeLayoutRowBudget(24, 6);
  assert.equal(budget.footerRows, 6);
  assert.equal(budget.controlRows, 15);
  assert.equal(budget.contentRows, 9);
  assert.equal(budget.transcriptRows, 7);
});

test("scrollbar thumb tracks newest content at the bottom", () => {
  const rail = buildScrollbarRail(8, 0, 12);
  const active = rail.map((entry) => entry.char).join("");
  assert.equal(active, "│││││███");
});

test("scrollbar thumb moves toward the top for older content", () => {
  const rail = buildScrollbarRail(8, 12, 12);
  const active = rail.map((entry) => entry.char).join("");
  assert.equal(active, "███│││││");
});

test("copy last falls back to subagent output when the main transcript has none", () => {
  const payload = buildCopyPayload(
    "last",
    [],
    [{ outputText: "subagent answer" }],
    [
      { indicator: "sub > ", text: "goal-finder [running]" },
      { indicator: "       ", text: "subagent answer" },
    ],
    [{ indicator: "       ", text: "subagent answer" }],
  );
  assert.equal(payload, "subagent answer");
});
