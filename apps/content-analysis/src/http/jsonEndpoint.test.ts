import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { parseJsonAnalysisRequest } from "./jsonEndpoint.js";

test("parseJsonAnalysisRequest normalizes arrays and strings", async () => {
  const req = Object.assign(
    Readable.from([Buffer.from(JSON.stringify({
      text: "hello",
      instructions: "focus on the heading",
      urls: ["https://example.com/a"],
      paths: ["docs/a.txt"],
    }))]),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
    },
  ) as IncomingMessage;

  const parsed = await parseJsonAnalysisRequest(req, 1024);
  assert.equal(parsed.text, "hello");
  assert.deepEqual(parsed.urls, ["https://example.com/a"]);
  assert.deepEqual(parsed.paths, ["docs/a.txt"]);
});
