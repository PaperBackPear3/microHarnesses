import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyComposerEnterAction,
  clipeRenderedToMaxRows,
  deleteBackward,
  deleteForward,
  estimateComposerRows,
  insertAtCursor,
  lineEnd,
  lineStart,
  moveCursorVertically,
  renderComposerValue,
  withCursor,
} from "./Composer.js";

test("insertAtCursor inserts full pasted chunks at cursor", () => {
  const inserted = insertAtCursor("hello world", 5, " brave\nnew");
  assert.equal(inserted.text, "hello brave\nnew world");
  assert.equal(inserted.cursor, 15);
});

test("insertAtCursor normalizes CRLF and bare CR in pasted chunks", () => {
  const crlf = insertAtCursor("ab", 2, "x\r\ny");
  assert.equal(crlf.text, "abx\ny");
  assert.equal(crlf.cursor, 5);
  const cr = insertAtCursor("ab", 2, "x\ry");
  assert.equal(cr.text, "abx\ny");
});

test("deleteBackward and deleteForward remove characters around cursor", () => {
  assert.deepEqual(deleteBackward("hello", 5), { text: "hell", cursor: 4 });
  assert.deepEqual(deleteForward("hello", 1), { text: "hllo", cursor: 1 });
  assert.equal(deleteBackward("hello", 0), undefined);
  assert.equal(deleteForward("hello", 5), undefined);
});

test("lineStart and lineEnd resolve current logical line bounds", () => {
  const value = "ab\ncdef\ng";
  assert.equal(lineStart(value, 4), 3);
  assert.equal(lineEnd(value, 4), 7);
});

test("moveCursorVertically keeps preferred column across lines", () => {
  const value = "abcd\nef\nghij";
  const fromFirstLine = moveCursorVertically(value, 3, 1);
  assert.equal(fromFirstLine, 7);
  const backUp = moveCursorVertically(value, fromFirstLine, -1);
  assert.equal(backUp, 2);
});

test("withCursor always renders a visible cursor", () => {
  assert.equal(withCursor("", 0), "█");
  assert.equal(withCursor("hello", 2), "he█llo");
  assert.equal(withCursor("hello", 99), "hello█");
});

test("estimateComposerRows accounts for wrapping and caps growth", () => {
  assert.equal(estimateComposerRows("", 20), 1);
  assert.equal(estimateComposerRows("1234567890", 5), 3);
  assert.equal(estimateComposerRows("a\nb\nc\nd\ne\nf\ng\nh", 20), 6);
});

test("clipeRenderedToMaxRows clips text exceeding max rows", () => {
  const rendered = "12345\nabcde\nXYZ";
  const clipped = clipeRenderedToMaxRows(rendered, 5, 2);
  const lines = clipped.split("\n");
  assert(lines.length <= 3);
  assert.equal(lines[0], "12345");
  assert.equal(lines[1], "abcde");
  assert(!rendered.includes(clipped) || clipped.includes("12345"));
});

test("clipeRenderedToMaxRows preserves content under max rows", () => {
  const rendered = "hello\nworld█";
  const clipped = clipeRenderedToMaxRows(rendered, 20, 3);
  assert.equal(clipped, rendered);
});

test("clipeRenderedToMaxRows handles single long line correctly", () => {
  const rendered = "1234567890█";
  const clipped = clipeRenderedToMaxRows(rendered, 5, 2);
  const lines = clipped.split("\n");
  assert(lines.length <= 2);
});

test("renderComposerValue windows long multiline input around cursor", () => {
  const value = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight";
  const cursorAt = value.indexOf("seven");
  const rendered = renderComposerValue(value, cursorAt, 20);
  const lines = rendered.split("\n");
  assert(lines.length <= 6);
  assert(rendered.includes("█"), "cursor glyph must be present");
  assert(!rendered.startsWith("one"), "should have scrolled past first lines");
});

test("renderComposerValue wraps long lines and stays within max rows", () => {
  const value = "1234567890abcdefghij";
  const rendered = renderComposerValue(value, value.length, 5);
  const lines = rendered.split("\n");
  assert(lines.length <= 6);
  assert(lines.every((l) => l.length <= 5));
  assert(rendered.includes("█"));
});

test("renderComposerValue leaves short input unchanged (cursor appended)", () => {
  assert.equal(renderComposerValue("hello\nworld", 11, 20), "hello\nworld█");
});

test("classifyComposerEnterAction distinguishes submit vs shift-enter newline", () => {
  assert.equal(
    classifyComposerEnterAction("\r", { return: true, shift: true, ctrl: false }),
    "newline",
  );
  assert.equal(
    classifyComposerEnterAction("[13;2u", {
      return: false,
      shift: false,
      ctrl: false,
    }),
    "newline",
  );
  assert.equal(
    classifyComposerEnterAction("[27;2;13~", {
      return: false,
      shift: false,
      ctrl: false,
    }),
    "newline",
  );
  assert.equal(
    classifyComposerEnterAction("\r", { return: true, shift: false, ctrl: false }),
    "submit",
  );
  assert.equal(
    classifyComposerEnterAction("[13;1u", {
      return: false,
      shift: false,
      ctrl: false,
    }),
    "submit",
  );
  assert.equal(
    classifyComposerEnterAction("[27;1;13~", {
      return: false,
      shift: false,
      ctrl: false,
    }),
    "submit",
  );
  assert.equal(
    classifyComposerEnterAction("x", { return: false, shift: false, ctrl: false }),
    undefined,
  );
});

test("classifyComposerEnterAction treats bare return as submit when shift metadata is unavailable", () => {
  assert.equal(
    classifyComposerEnterAction("\r", { return: true, shift: false, ctrl: false }),
    "submit",
  );
});
