import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSlashCommand } from "./commands";

test("parses /compact", () => {
  assert.deepEqual(parseSlashCommand("/compact"), { type: "compact" });
});

test("returns undefined for non-slash input", () => {
  assert.equal(parseSlashCommand("compact"), undefined);
});
