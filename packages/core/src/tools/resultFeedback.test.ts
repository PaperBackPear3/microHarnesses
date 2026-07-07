import assert from "node:assert/strict";
import test from "node:test";
import { renderToolResultFeedback } from "./resultFeedback";

test("renderToolResultFeedback keeps shell stdout beyond legacy 500-char cap", () => {
  const files = Array.from({ length: 140 }, (_, i) => `packages/core/src/file-${i}.ts`).join("\n");
  const text = renderToolResultFeedback(
    [{ name: "shell_exec", input: { command: "git diff --name-only HEAD^ HEAD" } }],
    [
      {
        ok: true,
        output: {
          stdout: files,
          stderr: "",
          truncated: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          exitCode: 0,
        },
      },
    ],
  );
  assert.match(text, /file-0\.ts/);
  assert.match(text, /file-139\.ts/);
});

test("renderToolResultFeedback includes artifact retrieval guidance", () => {
  const text = renderToolResultFeedback(
    [{ name: "shell_exec", input: { command: "git show -p" } }],
    [
      {
        ok: true,
        output: {
          stdout: "partial",
          stdoutTruncated: true,
          stdoutArtifact: { id: "abc123", path: "abc123.txt" },
          truncated: true,
        },
      },
    ],
  );
  assert.match(text, /tool_output_read id=abc123/);
});
