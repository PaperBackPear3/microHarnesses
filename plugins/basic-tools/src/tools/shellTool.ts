import { spawn } from "node:child_process";
import {
  captureToolText,
  type ToolDefinition,
  type ToolOutputArtifactRef,
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
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutTotalChars: number;
  stderrTotalChars: number;
  stdoutOmittedChars: number;
  stderrOmittedChars: number;
  stdoutArtifact?: ToolOutputArtifactRef;
  stderrArtifact?: ToolOutputArtifactRef;
  outputStorageTruncated: boolean;
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
        options.maxShellStoredChars,
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
  maxStoredChars: number,
  context?: ToolExecutionContext,
): Promise<ShellRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    const streams = {
      stdout: { content: "", totalChars: 0, storageTruncated: false },
      stderr: { content: "", totalChars: 0, storageTruncated: false },
    };
    let timedOut = false;
    let timedOutKillTimer: NodeJS.Timeout | undefined;

    const appendChunk = (target: "stdout" | "stderr", chunk: Buffer | string): void => {
      const text = chunk.toString("utf8");
      const stream = streams[target];
      stream.totalChars += text.length;
      if (stream.content.length >= maxStoredChars) {
        stream.storageTruncated = true;
        return;
      }
      const remaining = maxStoredChars - stream.content.length;
      if (text.length > remaining) {
        stream.content += text.slice(0, remaining);
        stream.storageTruncated = true;
        return;
      }
      stream.content += text;
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

    child.once("close", async (code, signal) => {
      clearTimeout(timeout);
      if (timedOutKillTimer) {
        clearTimeout(timedOutKillTimer);
      }
      try {
        const stdoutCapture = await captureToolText({
          toolName: "shell_exec",
          field: "stdout",
          content: streams.stdout.content,
          totalChars: streams.stdout.totalChars,
          maxInlineChars: maxOutputChars,
          artifacts: context?.outputArtifacts,
        });
        const stderrCapture = await captureToolText({
          toolName: "shell_exec",
          field: "stderr",
          content: streams.stderr.content,
          totalChars: streams.stderr.totalChars,
          maxInlineChars: maxOutputChars,
          artifacts: context?.outputArtifacts,
        });
        const stdoutTruncated = streams.stdout.totalChars > maxOutputChars;
        const stderrTruncated = streams.stderr.totalChars > maxOutputChars;
        resolve({
          exitCode: code ?? -1,
          signal,
          stdout: stdoutCapture.text,
          stderr: stderrCapture.text,
          truncated: stdoutTruncated || stderrTruncated,
          timedOut,
          stdoutTruncated,
          stderrTruncated,
          stdoutTotalChars: streams.stdout.totalChars,
          stderrTotalChars: streams.stderr.totalChars,
          stdoutOmittedChars: stdoutCapture.omittedChars,
          stderrOmittedChars: stderrCapture.omittedChars,
          ...(stdoutCapture.artifact ? { stdoutArtifact: stdoutCapture.artifact } : {}),
          ...(stderrCapture.artifact ? { stderrArtifact: stderrCapture.artifact } : {}),
          outputStorageTruncated: streams.stdout.storageTruncated || streams.stderr.storageTruncated,
        });
      } catch (error: unknown) {
        reject(error);
      }
    });
  });
}
