import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveOptions } from "../options";
import { createShellTool } from "./shellTool";

test("shell_exec runs command in workspace cwd", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-shell-"));
  try {
    const tool = createShellTool(resolveOptions({ rootDir: root }));
    const output = await tool.execute({ command: "printf 'hello'" });
    assert.equal(output.exitCode, 0);
    assert.equal(output.stdout, "hello");
    assert.equal(output.cwd, ".");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shell_exec rejects cwd traversal outside workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-shell-safe-"));
  try {
    const tool = createShellTool(resolveOptions({ rootDir: root }));
    await assert.rejects(() => tool.execute({ command: "pwd", cwd: "../" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
