import type { ToolDefinition } from "../tools/types";
import { captureToolText } from "../tools/outputArtifacts";
import type { ToolOutputArtifacts } from "../tools/outputArtifacts";
import { McpClient } from "./client";
import type { McpServerConfig } from "./types";

export interface McpToolset {
  serverName: string;
  tools: ToolDefinition[];
  close(): void;
}

export async function createMcpToolset(config: McpServerConfig): Promise<McpToolset> {
  const listed = await withClient(config, async (client) => await client.listTools());
  const serverName = normalizeServerName(config.name);
  const tools = listed.map<ToolDefinition>((tool) => {
    const toolName = `mcp__${serverName}__${tool.name}`;
    return {
      name: toolName,
      description: tool.description ?? `MCP tool ${tool.name} from ${config.name}`,
      risk: "high",
      inputSchema: tool.inputSchema ?? {
        type: "object",
        additionalProperties: true,
      },
      async execute(input, context) {
        const result = await withClient(
          config,
          async (client) => await client.callTool(tool.name, input),
        );
        return await formatMcpToolResult(config.name, tool.name, result, context?.outputArtifacts);
      },
    };
  });
  return {
    serverName: config.name,
    tools,
    close() {},
  };
}

export async function formatMcpToolResult(
  serverName: string,
  toolName: string,
  result: unknown,
  outputArtifacts?: ToolOutputArtifacts,
): Promise<Record<string, unknown>> {
  const serialized = safeJson(result);
  const captured = await captureToolText({
    toolName: `mcp__${serverName}__${toolName}`,
    field: "result",
    content: serialized,
    maxInlineChars: 80_000,
    artifacts: outputArtifacts,
  });
  if (!captured.truncated) {
    return {
      server: serverName,
      tool: toolName,
      result,
    };
  }
  return {
    server: serverName,
    tool: toolName,
    result: captured.text,
    resultTruncated: true,
    totalResultChars: captured.totalChars,
    omittedResultChars: captured.omittedChars,
    ...(captured.artifact ? { resultArtifact: captured.artifact } : {}),
  };
}

function normalizeServerName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_]+/g, "_");
}

async function withClient<T>(
  config: McpServerConfig,
  run: (client: McpClient) => Promise<T>,
): Promise<T> {
  const client = new McpClient(config);
  try {
    await client.initialize();
    return await run(client);
  } finally {
    client.close();
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
