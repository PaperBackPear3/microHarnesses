import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveOptions } from "../options";
import { createGrepTool } from "./grepTool";

test("grep_search returns line matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-grep-"));
  try {
    await writeFile(path.join(root, "a.txt"), "hello world\nbye world\n", "utf8");
    await writeFile(path.join(root, "b.txt"), "hello team\n", "utf8");
    const tool = createGrepTool(resolveOptions({ rootDir: root, maxSearchMatches: 50 }));
    const output = await tool.execute({ query: "hello" });
    assert.equal(output.totalMatches, 2);
    assert.ok(Array.isArray(output.matches));
    const matches = output.matches as Array<Record<string, unknown>>;
    assert.equal(matches[0]?.line, 1);
    assert.equal(matches[1]?.file, "b.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grep_search supports regex mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-grep-regex-"));
  try {
    await writeFile(path.join(root, "a.txt"), "ticket-123\nticket-999\n", "utf8");
    const tool = createGrepTool(resolveOptions({ rootDir: root }));
    const output = await tool.execute({
      query: "ticket-[0-9]{3}$",
      is_regex: true,
    });
    assert.equal(output.totalMatches, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
