import { readOptionalInteger, readOptionalString } from "../../shared/inputParsing";
import type { ToolDefinition } from "../../tools/types";

export function createToolOutputReadTool(): ToolDefinition {
  return {
    name: "tool_output_read",
    description: "Read persisted oversized tool output by artifact id/path with range controls.",
    risk: "low",
    tags: ["tool-output", "read-only"],
    capabilities: ["filesystem.read", "tool-output.read"],
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Artifact id returned by a previous tool call." },
        path: { type: "string", description: "Artifact relative path returned by a previous tool call." },
        offset: { type: "number", description: "Character offset for byte-range style reads." },
        max_chars: { type: "number", description: "Maximum characters to return." },
        start_line: { type: "number", description: "1-indexed line range start." },
        end_line: { type: "number", description: "1-indexed line range end." },
      },
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input, context) {
      const artifacts = context?.outputArtifacts;
      if (!artifacts) {
        throw new Error("tool_output_read: output artifacts are not available in this runtime");
      }
      const id = readOptionalString(input, "id", "");
      const artifactPath = readOptionalString(input, "path", "");
      const offset = readOptionalInteger(input, "offset", 0, 0, 20_000_000);
      const maxChars = readOptionalInteger(input, "max_chars", 40_000, 1, 2_000_000);
      const startLine = readOptionalInteger(input, "start_line", 0, 0, 2_000_000);
      const endLine = readOptionalInteger(input, "end_line", 0, 0, 2_000_000);

      if (!id && !artifactPath) {
        throw new Error('tool_output_read: provide either "id" or "path"');
      }

      const result = await artifacts.readText({
        ...(id ? { id } : {}),
        ...(artifactPath ? { path: artifactPath } : {}),
        ...(startLine > 0 || endLine > 0
          ? {
              ...(startLine > 0 ? { startLine } : {}),
              ...(endLine > 0 ? { endLine } : {}),
            }
          : { offset, maxChars }),
      });
      return result;
    },
  };
}
