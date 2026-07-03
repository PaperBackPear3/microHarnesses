import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveOptions } from "../options";
import { createFilesystemTools } from "./filesystemTools";

test("fs_read supports line ranges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-fs-read-"));
  try {
    const filePath = path.join(root, "note.txt");
    await writeFile(filePath, "one\ntwo\nthree\nfour\n", "utf8");
    const tools = createFilesystemTools(resolveOptions({ rootDir: root }));
    const fsRead = tools.find((tool) => tool.name === "fs_read");
    assert.ok(fsRead);
    const output = await fsRead.execute({ path: "note.txt", start_line: 2, end_line: 3 });
    assert.equal(output.content, "two\nthree");
    assert.equal(output.startLine, 2);
    assert.equal(output.endLine, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fs_write and fs_append update file content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-fs-write-"));
  try {
    const tools = createFilesystemTools(resolveOptions({ rootDir: root }));
    const fsWrite = tools.find((tool) => tool.name === "fs_write");
    const fsAppend = tools.find((tool) => tool.name === "fs_append");
    assert.ok(fsWrite);
    assert.ok(fsAppend);

    await fsWrite.execute({ path: "a.txt", content: "hello" });
    await fsAppend.execute({ path: "a.txt", content: " world" });
    const saved = await readFile(path.join(root, "a.txt"), "utf8");
    assert.equal(saved, "hello world");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fs_read rejects paths outside root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-fs-safe-"));
  try {
    const tools = createFilesystemTools(resolveOptions({ rootDir: root }));
    const fsRead = tools.find((tool) => tool.name === "fs_read");
    assert.ok(fsRead);
    await assert.rejects(() => fsRead.execute({ path: "../outside.txt" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fs_remove requires recursive flag for directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-basic-tools-fs-remove-"));
  try {
    const dir = path.join(root, "dir");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "x.txt"), "x", "utf8");

    const tools = createFilesystemTools(resolveOptions({ rootDir: root }));
    const fsRemove = tools.find((tool) => tool.name === "fs_remove");
    assert.ok(fsRemove);
    await assert.rejects(() => fsRemove.execute({ path: "dir" }));
    const output = await fsRemove.execute({ path: "dir", recursive: true });
    assert.equal(output.removed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
