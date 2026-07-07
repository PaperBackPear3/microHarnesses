import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSubagentPromptName } from "./subagentPromptName.js";

test("resolveSubagentPromptName defaults to coder when omitted", async () => {
  const resolved = await resolveSubagentPromptName(undefined, "/tmp/ignored");
  assert.equal(resolved, "coder");
});

test("resolveSubagentPromptName requires installed prompt packs when specified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-subagent-prompts-"));
  try {
    const coderDir = path.join(root, "coder");
    await mkdir(coderDir, { recursive: true });
    await writeFile(path.join(coderDir, "system.md"), "sys", "utf8");

    assert.equal(await resolveSubagentPromptName("coder", root), "coder");
    // Valid id shape but no matching pack -> "Unknown", lists valid packs.
    await assert.rejects(
      () => resolveSubagentPromptName("planner", root),
      /Unknown subagent promptName "planner".*Valid promptName values are: coder/s,
    );
    // Free-form label with a space -> rejected as an invalid id shape.
    await assert.rejects(
      () => resolveSubagentPromptName("letter echo", root),
      /Invalid subagent promptName "letter echo".*use the "model" field/s,
    );
    // Path-traversal attempt -> rejected as an invalid id shape.
    await assert.rejects(
      () => resolveSubagentPromptName("../escape", root),
      /Invalid subagent promptName/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
