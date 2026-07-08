import assert from "node:assert/strict";
import test from "node:test";
import { containsTerminalMouseSequence, parseMouseWheelDelta } from "./mouseSequences.js";

test("detects SGR mouse click sequences", () => {
  assert.equal(containsTerminalMouseSequence("\u001b[<0;39;47M"), true);
  assert.equal(containsTerminalMouseSequence("[<0;39;47M"), true);
  assert.equal(containsTerminalMouseSequence("\u001b[<0;39;47M\u001b[<0;40;47m"), true);
});

test("does not treat regular input as mouse sequences", () => {
  assert.equal(containsTerminalMouseSequence("hello"), false);
  assert.equal(containsTerminalMouseSequence("/copy all"), false);
  assert.equal(containsTerminalMouseSequence("[not a mouse event]"), false);
});

test("parses wheel up and down deltas from mouse sequences", () => {
  assert.equal(parseMouseWheelDelta("\u001b[<64;39;47M"), 3);
  assert.equal(parseMouseWheelDelta("\u001b[<65;39;47M"), -3);
  assert.equal(parseMouseWheelDelta("\u001b[<0;39;47M"), 0);
});
