import assert from "node:assert/strict";
import test from "node:test";
import { parseAgenticGoalOutput, parseAgenticSummaryOutput } from "./agenticOutputParsing";

test("parseAgenticSummaryOutput parses SUMMARY and HIGHLIGHTS sections", () => {
  const raw = [
    "SUMMARY: Fixed the login bug and added tests.",
    "HIGHLIGHTS:",
    "- Found root cause",
    "- Added regression test",
  ].join("\n");
  const parsed = parseAgenticSummaryOutput(raw);
  assert.equal(parsed.summary, "Fixed the login bug and added tests.");
  assert.deepEqual(parsed.highlights, ["Found root cause", "Added regression test"]);
});

test("parseAgenticSummaryOutput is case-insensitive on labels", () => {
  const raw = ["summary: lowercase label works", "highlights:", "* bullet with asterisk"].join(
    "\n",
  );
  const parsed = parseAgenticSummaryOutput(raw);
  assert.equal(parsed.summary, "lowercase label works");
  assert.deepEqual(parsed.highlights, ["bullet with asterisk"]);
});

test("parseAgenticSummaryOutput falls back to first non-empty line", () => {
  const parsed = parseAgenticSummaryOutput("Just a plain sentence with no markers.");
  assert.equal(parsed.summary, "Just a plain sentence with no markers.");
  assert.deepEqual(parsed.highlights, []);
});

test("parseAgenticSummaryOutput falls back to a slice of raw text when empty", () => {
  const parsed = parseAgenticSummaryOutput("");
  assert.equal(parsed.summary, "");
  assert.deepEqual(parsed.highlights, []);
});

test("parseAgenticGoalOutput parses GOAL and SUBGOALS sections", () => {
  const raw = [
    "GOAL: Ship the agentic compressor plugin.",
    "SUBGOALS:",
    "- Add tests",
    "- Wire into CLI",
  ].join("\n");
  const parsed = parseAgenticGoalOutput(raw);
  assert.equal(parsed.goal, "Ship the agentic compressor plugin.");
  assert.deepEqual(parsed.subgoals, ["Add tests", "Wire into CLI"]);
});

test("parseAgenticGoalOutput handles a GOAL with no SUBGOALS section", () => {
  const parsed = parseAgenticGoalOutput("GOAL: Just the goal, no subgoals.");
  assert.equal(parsed.goal, "Just the goal, no subgoals.");
  assert.deepEqual(parsed.subgoals, []);
});

test("parseAgenticGoalOutput falls back to first non-empty line", () => {
  const parsed = parseAgenticGoalOutput("The user wants X done.");
  assert.equal(parsed.goal, "The user wants X done.");
  assert.deepEqual(parsed.subgoals, []);
});
