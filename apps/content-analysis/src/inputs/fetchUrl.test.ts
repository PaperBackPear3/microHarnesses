import assert from "node:assert/strict";
import test from "node:test";
import { fetchUrlAsset } from "./fetchUrl.js";

test("fetchUrlAsset rejects private hosts before fetching", async () => {
  await assert.rejects(
    () =>
      fetchUrlAsset({
        url: "http://localhost/test.png",
        timeoutMs: 1000,
        maxBytes: 1024,
        maxRedirects: 1,
      }),
    /Blocked local or private host/,
  );
});
