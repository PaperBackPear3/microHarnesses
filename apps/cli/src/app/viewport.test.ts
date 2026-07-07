import assert from "node:assert/strict";
import { test } from "node:test";
import { sliceFromBottom } from "./viewport.js";

test("sliceFromBottom returns tail when offset is zero", () => {
  const lines = ["1", "2", "3", "4", "5"];
  const slice = sliceFromBottom(lines, 3, 0);
  assert.deepEqual(slice.visible, ["3", "4", "5"]);
  assert.equal(slice.maxOffset, 2);
  assert.equal(slice.offset, 0);
});

test("sliceFromBottom scrolls up with positive offset", () => {
  const lines = ["1", "2", "3", "4", "5"];
  const slice = sliceFromBottom(lines, 3, 1);
  assert.deepEqual(slice.visible, ["2", "3", "4"]);
  assert.equal(slice.maxOffset, 2);
  assert.equal(slice.offset, 1);
});

test("sliceFromBottom clamps offset bounds", () => {
  const lines = ["1", "2", "3"];
  const low = sliceFromBottom(lines, 2, -10);
  assert.equal(low.offset, 0);
  assert.deepEqual(low.visible, ["2", "3"]);

  const high = sliceFromBottom(lines, 2, 99);
  assert.equal(high.offset, 1);
  assert.deepEqual(high.visible, ["1", "2"]);
});
