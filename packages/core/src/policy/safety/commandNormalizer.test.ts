import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommand, splitCommandSegments, stripBypassChars } from "./commandNormalizer";

test("stripBypassChars removes backslash splices", () => {
  assert.equal(stripBypassChars("s\\udo rm"), "sudo rm");
});

test("stripBypassChars removes single/double quote splices between letters", () => {
  assert.equal(stripBypassChars('"su"do rm'), "sudo rm");
  assert.equal(stripBypassChars("s'u'do rm"), "sudo rm");
});

test("splitCommandSegments splits on && || ; | &", () => {
  const segments = splitCommandSegments("echo hi && sudo x ; ls | grep foo");
  assert.deepEqual(segments, ["echo hi", "sudo x", "ls", "grep foo"]);
});

test("splitCommandSegments extracts $(...) and backtick substitutions as separate segments", () => {
  const segments = splitCommandSegments("echo $(sudo rm -rf /) && whoami");
  assert.ok(segments.includes("echo"));
  assert.ok(segments.includes("whoami"));
  assert.ok(segments.some((s) => /sudo rm -rf/.test(s)));
});

test("normalizeCommand combines stripping and splitting", () => {
  const segments = normalizeCommand('echo hi && "su"do rm -rf /');
  assert.deepEqual(segments, ["echo hi", "sudo rm -rf /"]);
});

test("normalizeCommand handles simple single commands unchanged", () => {
  assert.deepEqual(normalizeCommand("ls -la"), ["ls -la"]);
});
