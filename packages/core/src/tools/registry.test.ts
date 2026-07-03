import assert from "node:assert/strict";
import test from "node:test";
import { DuplicateToolError, UnknownToolError } from "../shared/errors";
import { ToolRegistry } from "./registry";
import type { ToolDefinition } from "./types";

const tool = (name: string): ToolDefinition => ({
  name,
  description: "",
  risk: "low",
  async execute() {
    return {};
  },
});

test("registers and retrieves a tool by name", () => {
  const registry = new ToolRegistry();
  registry.register(tool("t1"));
  assert.equal(registry.get("t1").name, "t1");
});

test("throws DuplicateToolError on double registration", () => {
  const registry = new ToolRegistry();
  registry.register(tool("t1"));
  assert.throws(() => registry.register(tool("t1")), DuplicateToolError);
});

test("throws UnknownToolError when tool missing", () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.get("missing"), UnknownToolError);
});

test("has() reports registration status", () => {
  const registry = new ToolRegistry();
  registry.register(tool("t1"));
  assert.equal(registry.has("t1"), true);
  assert.equal(registry.has("t2"), false);
});

test("list() returns all registered tools", () => {
  const registry = new ToolRegistry();
  registry.register(tool("a"));
  registry.register(tool("b"));
  const names = registry.list().map((t) => t.name);
  assert.deepEqual(names.sort(), ["a", "b"]);
});
