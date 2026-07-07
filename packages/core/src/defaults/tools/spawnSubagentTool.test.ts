import assert from "node:assert/strict";
import test from "node:test";
import { createSpawnSubagentTool } from "./spawnSubagentTool";

test("spawn_subagent forwards name separately from promptName", async () => {
  let captured: Record<string, unknown> | undefined;
  const tool = createSpawnSubagentTool({
    async run() {
      throw new Error("not used");
    },
    async spawn(options) {
      captured = options as unknown as Record<string, unknown>;
      return { id: "sub-1", launchIndex: 1, status: "running" };
    },
    async wait() {
      return { completed: [], running: [] };
    },
    list() {
      return [];
    },
  });

  const result = await tool.execute({
    name: "letter echo",
    promptName: "coder",
    prompt: "echo m",
  });

  assert.equal(captured?.name, "letter echo");
  assert.equal(captured?.promptName, "coder");
  assert.equal(result.name, "letter echo");
});
