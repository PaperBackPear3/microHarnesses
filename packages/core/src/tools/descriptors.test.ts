import assert from "node:assert/strict";
import test from "node:test";
import { deriveToolDescriptors } from "./descriptors";
import type { ToolDefinition } from "./types";

test("deriveToolDescriptors uses explicit schema when available", () => {
  const tools: ToolDefinition[] = [
    {
      name: "echo",
      description: "echo",
      risk: "low",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async execute() {
        return {};
      },
    },
  ];

  const descriptors = deriveToolDescriptors(tools);
  assert.deepEqual(descriptors, [
    {
      name: "echo",
      description: "echo",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  ]);
});

test("deriveToolDescriptors falls back to permissive object schema", () => {
  const tools: ToolDefinition[] = [
    {
      name: "time",
      description: "time",
      risk: "low",
      async execute() {
        return {};
      },
    },
  ];

  const descriptors = deriveToolDescriptors(tools);
  assert.deepEqual(descriptors, [
    {
      name: "time",
      description: "time",
      inputSchema: { type: "object", additionalProperties: true },
    },
  ]);
});
