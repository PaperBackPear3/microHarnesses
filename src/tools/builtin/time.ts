import { ToolDefinition } from "../../core/types";

export const timeTool: ToolDefinition = {
  name: "time",
  description: "Returns current ISO time.",
  async execute() {
    return { now: new Date().toISOString() };
  }
};
