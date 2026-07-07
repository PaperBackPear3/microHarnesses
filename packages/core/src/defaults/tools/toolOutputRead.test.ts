import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ToolOutputArtifacts } from "../../tools/outputArtifacts";
import { createToolOutputReadTool } from "./toolOutputRead";

test("tool_output_read requires output artifact context", async () => {
  const tool = createToolOutputReadTool();
  await assert.rejects(() => tool.execute({ id: "missing" }), /not available/);
});

test("tool_output_read reads persisted artifacts by id", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-core-tool-output-read-"));
  try {
    const artifacts = new ToolOutputArtifacts({ rootDir: dir });
    const ref = await artifacts.writeText({
      toolName: "shell_exec",
      field: "stdout",
      content: "a\nb\nc\nd",
    });
    const tool = createToolOutputReadTool();
    const result = (await tool.execute(
      { id: ref.id, start_line: 2, end_line: 3 },
      { signal: new AbortController().signal, outputArtifacts: artifacts },
    )) as { content: string };
    assert.equal(result.content, "b\nc");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
