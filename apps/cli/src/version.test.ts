import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json";
import { CLI_VERSION } from "./version";

test("CLI_VERSION matches package.json version", () => {
  assert.equal(CLI_VERSION, packageJson.version);
});
