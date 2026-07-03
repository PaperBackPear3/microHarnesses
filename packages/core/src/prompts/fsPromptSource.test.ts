import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FsPromptSource } from "./fsPromptSource";

test("FsPromptSource blocks agent path traversal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-prompts-"));
  try {
    const source = new FsPromptSource({ rootDir: root });
    await assert.rejects(() => source.load("../escape", "task"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FsPromptSource strictVariables throws on missing template vars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-prompts-"));
  const agentDir = path.join(root, "default");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "system.md"), "hello {{name}}", "utf8");

  try {
    const source = new FsPromptSource({ rootDir: root, strictVariables: true });
    await assert.rejects(() => source.load("default", "task"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
