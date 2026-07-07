import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ToolOutputArtifacts } from "@micro-harnesses/core";
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

test("shell_exec stores oversized output and returns preview metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-shell-trunc-"));
  try {
    const artifactDir = path.join(root, ".artifacts");
    const tool = createShellTool(resolveOptions({ rootDir: root, maxShellOutputChars: 1_000 }));
    const output = await tool.execute(
      { command: "printf '%*s' 3000 | tr ' ' x" },
      {
        signal: new AbortController().signal,
        outputArtifacts: new ToolOutputArtifacts({ rootDir: artifactDir }),
      },
    );
    assert.equal(output.truncated, true);
    assert.equal(output.stdoutTruncated, true);
    assert.equal(output.stdoutTotalChars, 3000);
    const stdoutArtifact = output.stdoutArtifact as { path: string } | undefined;
    assert.ok(stdoutArtifact);
    const raw = await readFile(path.join(artifactDir, stdoutArtifact.path), "utf8");
    assert.equal(raw.length, 3000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
