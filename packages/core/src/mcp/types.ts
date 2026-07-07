export type McpTransport = "stdio" | "http";

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Timeout for startup lifecycle calls (initialize/listTools). */
  initTimeoutMs?: number;
  /** Timeout for individual MCP requests. */
  requestTimeoutMs?: number;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  content?: unknown;
  structuredContent?: Record<string, unknown>;
  [key: string]: unknown;
}
