import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CLI_VERSION } from "./version.js";

test("CLI_VERSION matches package.json version", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.equal(CLI_VERSION, packageJson.version);
});
