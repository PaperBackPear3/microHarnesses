import assert from "node:assert/strict";
import test from "node:test";
import { parseGoalOutput, parseSummaryOutput } from "./parseAgentOutput";

test("parseSummaryOutput parses SUMMARY and HIGHLIGHTS sections", () => {
  const raw = [
    "SUMMARY: Fixed the login bug and added tests.",
    "HIGHLIGHTS:",
    "- Found root cause",
    "- Added regression test",
  ].join("\n");
  const parsed = parseSummaryOutput(raw);
  assert.equal(parsed.summary, "Fixed the login bug and added tests.");
  assert.deepEqual(parsed.highlights, ["Found root cause", "Added regression test"]);
});

test("parseSummaryOutput is case-insensitive on labels", () => {
  const raw = ["summary: lowercase label works", "highlights:", "* bullet with asterisk"].join(
    "\n",
  );
  const parsed = parseSummaryOutput(raw);
  assert.equal(parsed.summary, "lowercase label works");
  assert.deepEqual(parsed.highlights, ["bullet with asterisk"]);
});

test("parseSummaryOutput falls back to first non-empty line when markers are missing", () => {
  const parsed = parseSummaryOutput("Just a plain sentence with no markers.");
  assert.equal(parsed.summary, "Just a plain sentence with no markers.");
  assert.deepEqual(parsed.highlights, []);
});

test("parseSummaryOutput falls back to a slice of raw text when everything is empty-ish", () => {
  const parsed = parseSummaryOutput("");
  assert.equal(parsed.summary, "");
  assert.deepEqual(parsed.highlights, []);
});

test("parseGoalOutput parses GOAL and SUBGOALS sections", () => {
  const raw = [
    "GOAL: Ship the agentic compressor plugin.",
    "SUBGOALS:",
    "- Add tests",
    "- Wire into CLI",
  ].join("\n");
  const parsed = parseGoalOutput(raw);
  assert.equal(parsed.goal, "Ship the agentic compressor plugin.");
  assert.deepEqual(parsed.subgoals, ["Add tests", "Wire into CLI"]);
});

test("parseGoalOutput handles a GOAL with no SUBGOALS section", () => {
  const parsed = parseGoalOutput("GOAL: Just the goal, no subgoals.");
  assert.equal(parsed.goal, "Just the goal, no subgoals.");
  assert.deepEqual(parsed.subgoals, []);
});

test("parseGoalOutput falls back to first non-empty line when markers are missing", () => {
  const parsed = parseGoalOutput("The user wants X done.");
  assert.equal(parsed.goal, "The user wants X done.");
  assert.deepEqual(parsed.subgoals, []);
});
