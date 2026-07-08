import assert from "node:assert/strict";
import test from "node:test";
import { detectMimeType, isImageMimeType, isTextMimeType } from "./mime.js";

test("detectMimeType recognizes common images and text formats", () => {
  assert.equal(detectMimeType("photo.png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), "image/png");
  assert.equal(detectMimeType("notes.txt", Uint8Array.from([0x68, 0x65, 0x6c, 0x6c, 0x6f])), "text/plain");
  assert.ok(isImageMimeType("image/png"));
  assert.ok(isTextMimeType("text/plain"));
});
