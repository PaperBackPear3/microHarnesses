import type { ToolDefinition } from "../tools/types";
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
      async execute(input) {
        const result = await withClient(
          config,
          async (client) => await client.callTool(tool.name, input),
        );
        return {
          server: config.name,
          tool: tool.name,
          result,
        };
      },
    };
  });
  return {
    serverName: config.name,
    tools,
    close() {},
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
