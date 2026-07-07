import assert from "node:assert/strict";
import { test } from "node:test";

test("layout row budget calculation", () => {
  const viewportHeight = 30;
  const composerRows = 3;
  const composerBoxRows = 1;
  const footerMarginRows = 1;
  const footerTextRows = 3;
  const controlRows = composerRows + composerBoxRows + footerMarginRows + footerTextRows;
  const contentRows = Math.max(1, viewportHeight - controlRows);

  assert.equal(controlRows, 8);
  assert.equal(contentRows, 22);
});

test("layout row budget ensures content is visible", () => {
  const viewportHeight = 24;
  const composerRows = 2;
  const composerBoxRows = 1;
  const footerMarginRows = 1;
  const footerTextRows = 3;
  const controlRows = composerRows + composerBoxRows + footerMarginRows + footerTextRows;
  const contentRows = Math.max(1, viewportHeight - controlRows);

  assert(contentRows > 0);
  assert.equal(contentRows + controlRows, 24);
});

test("layout row budget accounts for max composer rows", () => {
  const viewportHeight = 24;
  const maxComposerRows = 6;
  const composerBoxRows = 1;
  const footerMarginRows = 1;
  const footerTextRows = 3;
  const maxControlRows = maxComposerRows + composerBoxRows + footerMarginRows + footerTextRows;

  assert(maxControlRows <= 11);
  assert.equal(maxControlRows, 11);
  const contentRows = Math.max(1, viewportHeight - maxControlRows);
  assert(contentRows >= 13);
});
