import { ToolDefinition } from "../../types";

export const echoTool: ToolDefinition = {
  name: "echo",
  description: "Returns input text as-is.",
  risk: "low",
  async execute(input) {
    const text = String(input.text ?? "");
    return { text };
  }
};
