import type { ToolDefinition } from "@micro-harness/core";

export const timeTool: ToolDefinition = {
  name: "time",
  description: "Returns current ISO time.",
  risk: "low",
  async execute() {
    return { now: new Date().toISOString() };
  },
};
