import assert from "node:assert/strict";
import test from "node:test";
import { type SubagentStatus, type ViewPreferences, buildChatLines } from "./chatLines.js";
import type { ChatEntry } from "./transcript.js";

const preferences: ViewPreferences = {
  thinkingExpanded: true,
  diagnosticsExpanded: true,
};

test("does not print literal iteration text for first iteration", () => {
  const entries: ChatEntry[] = [
    {
      id: "turn-1",
      type: "turn",
      turn: {
        id: "turn-1",
        userText: "hello",
        steps: [
          {
            id: "step-1",
            iteration: 1,
            thinkingText: "reasoning",
            assistantText: "response",
            systemMessages: [{ id: "m1", text: "tool started: ls" }],
            thinkingCollapsed: false,
          },
        ],
      },
    },
  ];

  const lines = buildChatLines(entries, [], false, undefined, 120, preferences);
  const rendered = lines.map((line) => `${line.indicator}${line.text}`).join("\n");

  assert(!rendered.includes("iteration"));
  assert(rendered.includes("[expanded]"));
  assert(rendered.includes("● response"));
});

test("uses #N prefix for iteration > 1", () => {
  const entries: ChatEntry[] = [
    {
      id: "turn-1",
      type: "turn",
      turn: {
        id: "turn-1",
        userText: "hello",
        steps: [
          {
            id: "step-2",
            iteration: 2,
            thinkingText: "reasoning",
            assistantText: "response",
            systemMessages: [{ id: "m1", text: "tool started: ls" }],
            thinkingCollapsed: false,
          },
        ],
      },
    },
  ];

  const lines = buildChatLines(entries, [], false, undefined, 120, preferences);
  const rendered = lines.map((line) => `${line.indicator}${line.text}`).join("\n");
  assert(rendered.includes("#2 [expanded]"));
  assert(rendered.includes("● response"));
  assert(!rendered.includes("● #2"), "iteration prefix must not appear in agent text");
  assert(rendered.includes("∙ #2 tool started: ls"));
});

test("shows approval prompt even when diagnostics are collapsed", () => {
  const lines = buildChatLines(
    [],
    [] satisfies SubagentStatus[],
    false,
    {
      request: {
        tool: { name: "fs_write", metadata: {} as never },
        call: { input: { path: "a.txt", content: "x" } as never } as never,
      } as never,
      preview: "preview line",
    },
    120,
    { thinkingExpanded: false, diagnosticsExpanded: false },
  );
  const rendered = lines.map((line) => `${line.indicator}${line.text}`).join("\n");
  assert(rendered.includes("approval required: fs_write"));
  assert(rendered.includes("preview line"));
});

test("does not show collapsed diagnostics hint when nothing is hidden", () => {
  const lines = buildChatLines([], [], false, undefined, 120, {
    thinkingExpanded: true,
    diagnosticsExpanded: false,
  });
  const rendered = lines.map((line) => `${line.indicator}${line.text}`).join("\n");
  assert.equal(rendered, "");
});

test("multi-line agent response has only one agent > prefix", () => {
  const entries: ChatEntry[] = [
    {
      id: "t1",
      type: "turn",
      turn: {
        id: "t1",
        userText: "hi",
        steps: [
          {
            id: "s1",
            iteration: 1,
            thinkingText: "",
            assistantText: "line one\n\nline three",
            systemMessages: [],
            thinkingCollapsed: false,
          },
        ],
      },
    },
  ];
  const lines = buildChatLines(entries, [], false, undefined, 120, preferences);
  const indicatorLines = lines.filter((l) => l.indicator.trim() === "●").map((l) => l.text);
  assert.equal(indicatorLines.length, 1, "only the first line should have the agent indicator");
  assert.equal(indicatorLines[0], "line one");
  const continuationTexts = lines
    .filter((l) => l.indicator.trim() === "" && l.indicator.length > 0)
    .map((l) => l.text);
  assert(continuationTexts.includes(""), "blank paragraph line should be a continuation");
  assert(continuationTexts.includes("line three"), "second paragraph should be a continuation");
});

test("renders subagent blocks with separate name, status, and stream content", () => {
  const lines = buildChatLines(
    [],
    [
      {
        sessionId: "s-sub",
        name: "goal-finder",
        promptName: "coder",
        model: "gpt-x",
        status: "running",
        activity: "responding",
        thinkingText: "plan",
        outputText: "answer",
        recentTools: ["shell_exec started"],
      },
    ] satisfies SubagentStatus[],
    false,
    undefined,
    120,
    preferences,
  );
  const rendered = lines.map((line) => `${line.indicator}${line.text}`).join("\n");
  assert(rendered.includes("sub > goal-finder [running]"));
  assert(rendered.includes("subagents"));
  assert(rendered.includes("persona=coder"));
  assert(rendered.includes("thinking [expanded]:"));
  assert(rendered.includes("output:"));
  assert(rendered.includes("tools: shell_exec started"));
});

test("bounds long thinking blocks to avoid filling transcript", () => {
  const entries: ChatEntry[] = [
    {
      id: "turn-1",
      type: "turn",
      turn: {
        id: "turn-1",
        userText: "hello",
        steps: [
          {
            id: "step-1",
            iteration: 1,
            thinkingText: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10",
            assistantText: "",
            systemMessages: [],
            thinkingCollapsed: false,
          },
        ],
      },
    },
  ];

  const lines = buildChatLines(entries, [], false, undefined, 120, preferences);
  const rendered = lines.map((line) => `${line.indicator}${line.text}`).join("\n");
  assert(rendered.includes("... 2 line(s) hidden"));
  assert.equal(
    lines.some((line) => line.indicator === "  " && line.text === "1"),
    false,
  );
  assert(lines.some((line) => line.text === "10"));
});
