import { spawn } from "node:child_process";
import {
  type ToolDefinition,
  type ToolExecutionContext,
  readOptionalInteger,
  readOptionalString,
  readRequiredString,
  relativeToRoot,
  resolveWorkspacePath,
} from "@micro-harnesses/core";
import type { BasicToolsResolvedOptions } from "../options";

interface ShellRunResult {
  exitCode: number;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export function createShellTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "shell_exec",
    description: "Execute a shell command in the workspace with timeout and bounded output.",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        cwd: { type: "string", description: "Workspace-relative working directory." },
        timeout_ms: { type: "number", description: "Execution timeout in milliseconds." },
      },
      required: ["command"],
      additionalProperties: false,
    },
    inputAnnotations: [
      { field: "command", kind: "shell_command" },
      { field: "cwd", kind: "file_path" },
    ],
    async execute(input, context) {
      const command = readRequiredString(input, "command", "shell_exec");
      const requestedCwd = readOptionalString(input, "cwd", ".");
      const cwd = resolveWorkspacePath(options.rootDir, requestedCwd);
      const timeoutMs = readOptionalInteger(
        input,
        "timeout_ms",
        options.defaultShellTimeoutMs,
        500,
        options.maxShellTimeoutMs,
      );

      const result = await runShellCommand(
        command,
        cwd,
        timeoutMs,
        options.maxShellOutputChars,
        context,
      );
      return {
        command,
        cwd: relativeToRoot(options.rootDir, cwd),
        timeoutMs,
        ...result,
      };
    },
  };
}

async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  maxOutputChars: number,
  context?: ToolExecutionContext,
): Promise<ShellRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let timedOutKillTimer: NodeJS.Timeout | undefined;

    const appendChunk = (target: "stdout" | "stderr", chunk: Buffer | string): void => {
      const current = target === "stdout" ? stdout : stderr;
      const value = current + chunk.toString("utf8");
      if (value.length > maxOutputChars) {
        const capped = value.slice(0, maxOutputChars);
        if (target === "stdout") {
          stdout = capped;
        } else {
          stderr = capped;
        }
        truncated = true;
        return;
      }
      if (target === "stdout") {
        stdout = value;
      } else {
        stderr = value;
      }
    };

    child.stdout?.on("data", (chunk) => appendChunk("stdout", chunk));
    child.stderr?.on("data", (chunk) => appendChunk("stderr", chunk));

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      timedOutKillTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      timedOutKillTimer.unref();
    }, timeoutMs);
    timeout.unref();

    child.once("error", (error) => {
      clearTimeout(timeout);
      if (timedOutKillTimer) {
        clearTimeout(timedOutKillTimer);
      }
      reject(error);
    });

    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOutKillTimer) {
        clearTimeout(timedOutKillTimer);
      }
      resolve({
        exitCode: code ?? -1,
        signal,
        stdout,
        stderr,
        truncated,
        timedOut,
      });
    });
  });
}
