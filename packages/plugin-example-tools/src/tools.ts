import type { ToolDefinition } from "@micro-harness/core";

export const echoTool: ToolDefinition = {
  name: "echo",
  description: "Returns input text as-is.",
  risk: "low",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to echo back." },
    },
    required: ["text"],
    additionalProperties: false,
  },
  async execute(input) {
    const text = String(input.text ?? input.input ?? "");
    return { text };
  },
};

export const timeTool: ToolDefinition = {
  name: "time",
  description: "Returns current ISO time.",
  risk: "low",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  async execute() {
    return { now: new Date().toISOString() };
  },
};
