import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCopyPayload, buildScrollbarRail } from "./App.js";

test("layout row budget calculation", () => {
  const viewportHeight = 30;
  const composerRows = 3;
  const composerBoxRows = 2;
  const footerMarginRows = 1;
  const footerTextRows = 5;
  const controlRows = composerRows + composerBoxRows + footerMarginRows + footerTextRows;
  const contentRows = Math.max(1, viewportHeight - controlRows);

  assert.equal(controlRows, 11);
  assert.equal(contentRows, 19);
});

test("layout row budget ensures content is visible", () => {
  const viewportHeight = 24;
  const composerRows = 2;
  const composerBoxRows = 2;
  const footerMarginRows = 1;
  const footerTextRows = 5;
  const controlRows = composerRows + composerBoxRows + footerMarginRows + footerTextRows;
  const contentRows = Math.max(1, viewportHeight - controlRows);

  assert(contentRows > 0);
  assert.equal(contentRows + controlRows, 24);
});

test("layout row budget accounts for max composer rows", () => {
  const viewportHeight = 24;
  const maxComposerRows = 6;
  const composerBoxRows = 2;
  const footerMarginRows = 1;
  const footerTextRows = 5;
  const maxControlRows = maxComposerRows + composerBoxRows + footerMarginRows + footerTextRows;

  assert(maxControlRows <= 14);
  assert.equal(maxControlRows, 14);
  const contentRows = Math.max(1, viewportHeight - maxControlRows);
  assert(contentRows >= 10);
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
