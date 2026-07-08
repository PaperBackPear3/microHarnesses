import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatBytes, parseDroppedAttachmentPaths, stageAttachment } from "./attachments.js";

test("stageAttachment resolves file metadata and mime type", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-attachments-"));
  try {
    const filePath = path.join(dir, "image.png");
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const staged = await stageAttachment(filePath);
    assert.equal(staged.filename, "image.png");
    assert.equal(staged.mimeType, "image/png");
    assert.equal(staged.sizeBytes, 4);
    assert.equal(path.isAbsolute(staged.path), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatBytes keeps user-friendly units", () => {
  assert.equal(formatBytes(12), "12B");
  assert.equal(formatBytes(2048), "2KB");
  assert.equal(formatBytes(2 * 1024 * 1024), "2.0MB");
});

test("parseDroppedAttachmentPaths supports quoted and escaped terminal payloads", () => {
  assert.deepEqual(parseDroppedAttachmentPaths("/tmp/image.png"), ["/tmp/image.png"]);
  assert.deepEqual(parseDroppedAttachmentPaths("'/tmp/file with spaces.png'"), [
    "/tmp/file with spaces.png",
  ]);
  assert.deepEqual(parseDroppedAttachmentPaths("/tmp/file\\ with\\ spaces.png"), [
    "/tmp/file with spaces.png",
  ]);
  assert.deepEqual(parseDroppedAttachmentPaths('"/tmp/a one.png" "/tmp/b two.png"'), [
    "/tmp/a one.png",
    "/tmp/b two.png",
  ]);
});
