import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { McpCallResult, McpServerConfig, McpToolDescriptor } from "./types";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
  };
}

type PendingCall = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

export class McpClient {
  private readonly config: McpServerConfig;
  private child?: ChildProcessWithoutNullStreams;
  private requestId = 1;
  private readonly pending = new Map<number, PendingCall>();

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.config.transport === "stdio") {
      await this.ensureStdioProcess();
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "micro-harnesses-core",
          version: "1.0.0",
        },
      });
      return;
    }
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "micro-harnesses-core",
        version: "1.0.0",
      },
    });
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.request("tools/list");
    const tools = result.tools;
    if (!Array.isArray(tools)) {
      return [];
    }
    return tools
      .filter((tool): tool is Record<string, unknown> => typeof tool === "object" && tool !== null)
      .map((tool) => ({
        name: String(tool.name ?? ""),
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        ...(isRecord(tool.inputSchema) ? { inputSchema: tool.inputSchema } : {}),
      }))
      .filter((tool) => tool.name.length > 0);
  }

  async callTool(name: string, argumentsPayload: Record<string, unknown>): Promise<McpCallResult> {
    const result = await this.request("tools/call", {
      name,
      arguments: argumentsPayload,
    });
    return result as McpCallResult;
  }

  close(): void {
    for (const [id, call] of this.pending.entries()) {
      call.reject(new Error(`MCP call ${id} cancelled because client closed`));
    }
    this.pending.clear();
    if (this.child) {
      this.child.kill();
      this.child = undefined;
    }
  }

  private async request(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.config.transport === "http") {
      return await this.httpRequest(method, params);
    }
    await this.ensureStdioProcess();
    return await this.stdioRequest(method, params);
  }

  private async httpRequest(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.config.url) {
      throw new Error(`MCP server "${this.config.name}" is missing url for http transport`);
    }
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.requestId++,
      method,
      ...(params ? { params } : {}),
    };
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new Error(`MCP HTTP request failed (${response.status})`);
    }
    const payload = (await response.json()) as JsonRpcResponse;
    if (payload.error) {
      throw new Error(`MCP error (${payload.error.code}): ${payload.error.message}`);
    }
    if (!payload.result || typeof payload.result !== "object") {
      return {};
    }
    return payload.result;
  }

  private async stdioRequest(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.child?.stdin.writable) {
      throw new Error(`MCP stdio process for "${this.config.name}" is not writable`);
    }
    const id = this.requestId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.child.stdin.write(`${JSON.stringify(request)}\n`);
    return await promise;
  }

  private async ensureStdioProcess(): Promise<void> {
    if (this.child) return;
    if (!this.config.command) {
      throw new Error(`MCP server "${this.config.name}" is missing command for stdio transport`);
    }
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ...(this.config.env ?? {}),
      },
      stdio: "pipe",
    });
    this.child = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = chunk
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        try {
          const response = JSON.parse(line) as JsonRpcResponse;
          if (typeof response.id !== "number") continue;
          const pending = this.pending.get(response.id);
          if (!pending) continue;
          this.pending.delete(response.id);
          if (response.error) {
            pending.reject(
              new Error(`MCP error (${response.error.code}): ${response.error.message}`),
            );
            continue;
          }
          pending.resolve(isRecord(response.result) ? response.result : {});
        } catch {
          // Ignore non-JSON lines from server stderr-like stdout chatter.
        }
      }
    });

    child.stderr.on("data", () => {
      // MCP servers often write logs to stderr. Avoid failing calls on logs.
    });

    child.on("exit", (code, signal) => {
      const reason = `MCP stdio process exited (code=${String(code)}, signal=${String(signal)})`;
      for (const [id, pending] of this.pending.entries()) {
        pending.reject(new Error(`${reason}; pending request ${id}`));
      }
      this.pending.clear();
      this.child = undefined;
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
