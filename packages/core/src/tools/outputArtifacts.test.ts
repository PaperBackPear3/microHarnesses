import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ToolOutputArtifacts,
  captureToolText,
  createToolTextPreview,
} from "./outputArtifacts";

test("createToolTextPreview returns head-tail preview for long text", () => {
  const text = "a".repeat(60) + "b".repeat(60);
  const preview = createToolTextPreview(text, 80);
  assert.equal(preview.truncated, true);
  assert.equal(preview.totalChars, 120);
  assert.equal(preview.omittedChars > 0, true);
  assert.match(preview.text, /\[truncated\]/);
});

test("ToolOutputArtifacts writes and reads text ranges", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-core-artifacts-"));
  try {
    const artifacts = new ToolOutputArtifacts({ rootDir: dir });
    const ref = await artifacts.writeText({
      toolName: "shell_exec",
      field: "stdout",
      content: "line1\nline2\nline3\nline4",
    });
    const byId = await artifacts.readText({ id: ref.id, startLine: 2, endLine: 3 });
    assert.equal(byId.content, "line2\nline3");
    const byOffset = await artifacts.readText({ path: ref.path, offset: 0, maxChars: 5 });
    assert.equal(byOffset.content, "line1");
    assert.equal(byOffset.truncated, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("captureToolText persists artifact when inline limit is exceeded", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-core-artifacts-cap-"));
  try {
    const artifacts = new ToolOutputArtifacts({ rootDir: dir });
    const captured = await captureToolText({
      toolName: "fs_read",
      field: "content",
      content: "x".repeat(200),
      maxInlineChars: 40,
      artifacts,
    });
    assert.equal(captured.truncated, true);
    assert.ok(captured.artifact);
    const read = await artifacts.readText({ id: captured.artifact.id });
    assert.equal(read.totalChars, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
