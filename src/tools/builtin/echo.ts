import { ToolDefinition } from "../../core/types";

export const echoTool: ToolDefinition = {
  name: "echo",
  description: "Returns input text as-is.",
  async execute(input) {
    const text = String(input.text ?? "");
    return { text };
  }
};
