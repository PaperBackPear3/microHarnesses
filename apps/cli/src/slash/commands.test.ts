import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSlashCommand } from "./commands.js";

test("parses /compact", () => {
  assert.deepEqual(parseSlashCommand("/compact"), { type: "compact" });
});

test("parses /wait", () => {
  assert.deepEqual(parseSlashCommand("/wait"), { type: "wait-subagents" });
});

test("returns undefined for non-slash input", () => {
  assert.equal(parseSlashCommand("compact"), undefined);
});

test("parses /model with no args as list-models", () => {
  assert.deepEqual(parseSlashCommand("/model"), { type: "list-models" });
});

test("parses /model auto as clearing the override", () => {
  assert.deepEqual(parseSlashCommand("/model auto"), { type: "set-model", model: undefined });
});

test("parses /model <name> as setting an override", () => {
  assert.deepEqual(parseSlashCommand("/model gpt-4.1-mini"), {
    type: "set-model",
    model: "gpt-4.1-mini",
  });
});

test("parses /route <preference>", () => {
  assert.deepEqual(parseSlashCommand("/route cost"), {
    type: "set-routing-preference",
    preference: "cost",
  });
  assert.deepEqual(parseSlashCommand("/route auto"), {
    type: "set-routing-preference",
    preference: "auto",
  });
});

test("parses /route with no args or off as clearing the preference", () => {
  assert.deepEqual(parseSlashCommand("/route"), {
    type: "set-routing-preference",
    preference: undefined,
  });
  assert.deepEqual(parseSlashCommand("/route off"), {
    type: "set-routing-preference",
    preference: undefined,
  });
});

test("ignores /route with an unknown preference", () => {
  assert.equal(parseSlashCommand("/route nonsense"), undefined);
});
