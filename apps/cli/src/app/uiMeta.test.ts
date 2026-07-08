import assert from "node:assert/strict";
import { test } from "node:test";
import type { StatusState } from "../telemetry/status.js";
import {
  compactShortcutHintLine,
  contextBadgeStyle,
  helpCommandLines,
  helpShortcutLines,
  modePromptStyle,
  modelBadgeLabel,
} from "./uiMeta.js";

function baseStatus(): StatusState {
  return {
    tokensIn: 0,
    tokensOut: 0,
    turns: 0,
    errors: 0,
    limitHits: 0,
    compressing: false,
  };
}

test("modePromptStyle returns per-mode labels and colors", () => {
  assert.deepEqual(modePromptStyle("plan"), { label: "PLAN", color: "yellow" });
  assert.deepEqual(modePromptStyle("accept-edits"), { label: "EDITS", color: "green" });
  assert.deepEqual(modePromptStyle("autopilot"), { label: "AUTO", color: "magenta" });
});

test("modelBadgeLabel falls back to default", () => {
  assert.equal(modelBadgeLabel("gpt-5.3-codex"), "model gpt-5.3-codex");
  assert.equal(modelBadgeLabel(undefined), "model default");
});

test("contextBadgeStyle maps utilization to colors", () => {
  assert.deepEqual(contextBadgeStyle(baseStatus()), { label: "ctx n/a", color: "gray" });

  const low = contextBadgeStyle({
    ...baseStatus(),
    contextUsedTokens: 25_000,
    contextMaxTokens: 100_000,
  });
  assert.equal(low.color, "green");
  assert.equal(low.label, "ctx 25% (25,000/100,000)");

  const medium = contextBadgeStyle({
    ...baseStatus(),
    contextUtilization: 0.65,
    contextUsedTokens: 65_000,
    contextMaxTokens: 100_000,
  });
  assert.equal(medium.color, "yellow");
  assert.equal(medium.label, "ctx 65% (65,000/100,000)");

  const high = contextBadgeStyle({
    ...baseStatus(),
    contextUtilization: 0.9,
    contextUsedTokens: 90_000,
    contextMaxTokens: 100_000,
  });
  assert.equal(high.color, "red");
  assert.equal(high.label, "ctx 90% (90,000/100,000)");
});

test("help lines include commands and shortcuts discoverability", () => {
  const commands = helpCommandLines(["gpt-5.3-codex", "claude-sonnet-5"]);
  assert(commands.includes("/help | /commands"));
  assert(commands.includes("Attachments:"));
  assert(commands.includes("Utilities:"));
  assert(commands.includes("/copy [last|visible|all]"));
  assert(commands.includes("/compact"));
  assert(commands.includes("/wait"));
  assert(
    commands.includes(
      '/model [id] (no args lists models across all configured providers; choices: gpt-5.3-codex, claude-sonnet-5; "auto" clears override)',
    ),
    "expected dynamic model line to be rendered in help commands",
  );
  assert(
    commands.some((line) => line.startsWith("/route ")),
    "expected /route command to be listed",
  );

  const shortcuts = helpShortcutLines();
  assert(
    shortcuts.some((line) => line.startsWith("Shift+Tab")),
    "expected mode-cycle shortcut",
  );
  assert(
    shortcuts.some((line) => line.startsWith("Shift+Enter")),
    "expected multiline composer shortcut",
  );
  assert(
    shortcuts.some((line) => line.startsWith("Mouse wheel")),
    "expected mouse wheel shortcut",
  );
  assert(
    shortcuts.some((line) => line.startsWith("/copy")),
    "expected copy command shortcut hint",
  );
  assert(
    shortcuts.some((line) => line.startsWith("← / →")),
    "expected cursor movement shortcut",
  );
  assert(
    shortcuts.some((line) => line.startsWith("Ctrl+D")),
    "expected exit shortcut",
  );
  assert(
    shortcuts.some((line) => line.startsWith("Ctrl+Y")),
    "expected diagnostics-toggle shortcut",
  );
  assert(
    shortcuts.some((line) => line.startsWith("Esc / Ctrl+C")),
    "expected interrupt shortcut",
  );
  assert.match(compactShortcutHintLine(), /Shift\+Enter newline/);
  assert.match(compactShortcutHintLine(), /wheel\/PgUp\/PgDn scroll/);
  assert.match(compactShortcutHintLine(), /\/copy clipboard/);
  assert.match(compactShortcutHintLine(), /Ctrl\+Y diagnostics/);
});
