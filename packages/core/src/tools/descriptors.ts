import type { ToolDefinition, ToolDescriptor } from "./types";

const DEFAULT_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: true,
};

export function toToolDescriptor(tool: ToolDefinition): ToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? DEFAULT_INPUT_SCHEMA,
  };
}

export function deriveToolDescriptors(tools: ToolDefinition[]): ToolDescriptor[] {
  return tools.map(toToolDescriptor);
}
