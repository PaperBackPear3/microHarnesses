import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ToolOutputArtifacts } from "../../tools/outputArtifacts";
import { createReadOnlyWorkspaceTools } from "./workspaceReadOnly";

test("fs_read persists oversized content artifact and returns preview", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-core-workspace-ro-"));
  try {
    const artifactDir = path.join(root, ".artifacts");
    const file = path.join(root, "big.txt");
    await writeFile(file, "A".repeat(300), "utf8");
    const fsRead = createReadOnlyWorkspaceTools({ rootDir: root, maxReadChars: 100 }).find(
      (tool) => tool.name === "fs_read",
    );
    assert.ok(fsRead);
    const result = (await fsRead.execute(
      { path: "big.txt", max_chars: 80 },
      {
        signal: new AbortController().signal,
        outputArtifacts: new ToolOutputArtifacts({ rootDir: artifactDir }),
      },
    )) as {
      truncated: boolean;
      content: string;
      totalChars?: number;
      contentArtifact?: { id: string; path: string };
    };

    assert.equal(result.truncated, true);
    assert.ok(result.content.includes("[truncated]"));
    assert.equal(result.totalChars, 300);
    assert.ok(result.contentArtifact);
    const raw = await readFile(path.join(artifactDir, result.contentArtifact.path), "utf8");
    assert.equal(raw.length, 300);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
