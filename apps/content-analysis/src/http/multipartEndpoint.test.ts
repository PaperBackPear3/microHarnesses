import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { parseMultipartAnalysisRequest } from "./multipartEndpoint.js";

test("parseMultipartAnalysisRequest reads text fields and uploaded files", async () => {
  const form = new FormData();
  form.set("text", "hello");
  form.set("instructions", "be concise");
  form.set("urls", "https://example.com/a,https://example.com/b");
  form.set(
    "file",
    new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], "photo.png", { type: "image/png" }),
  );
  const request = new Request("http://localhost/analyze", { method: "POST", body: form });
  const body = Buffer.from(await request.arrayBuffer());
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const req = Object.assign(Readable.from([body]), {
    method: "POST",
    headers,
  }) as IncomingMessage;

  const parsed = await parseMultipartAnalysisRequest(req, 1024 * 1024);
  assert.equal(parsed.text, "hello");
  assert.equal(parsed.instructions, "be concise");
  assert.deepEqual(parsed.urls, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0]?.filename, "photo.png");
});
