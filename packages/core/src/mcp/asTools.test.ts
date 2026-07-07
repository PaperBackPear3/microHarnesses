import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ToolOutputArtifacts } from "../tools/outputArtifacts";
import { formatMcpToolResult } from "./asTools";

test("formatMcpToolResult keeps structured payload when small", async () => {
  const result = await formatMcpToolResult("demo", "echo", { ok: true }, undefined);
  assert.deepEqual(result, {
    server: "demo",
    tool: "echo",
    result: { ok: true },
  });
});

test("formatMcpToolResult truncates oversized payload and persists artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-core-mcp-"));
  try {
    const artifacts = new ToolOutputArtifacts({ rootDir: root });
    const large = { text: "x".repeat(120_000) };
    const result = await formatMcpToolResult("demo", "big", large, artifacts);
    assert.equal(result.resultTruncated, true);
    assert.equal(typeof result.result, "string");
    assert.ok(result.resultArtifact);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
