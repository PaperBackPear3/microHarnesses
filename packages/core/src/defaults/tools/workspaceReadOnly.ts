import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  readOptionalBoolean,
  readOptionalInteger,
  readOptionalString,
  readRequiredString,
} from "../../shared/inputParsing";
import { relativeToRoot, resolveWorkspacePath } from "../../shared/paths";
import { truncate } from "../../shared/text";
import { captureToolText } from "../../tools/outputArtifacts";
import type { ToolDefinition, ToolExecutionContext } from "../../tools/types";

export interface ReadOnlyWorkspaceToolsOptions {
  rootDir: string;
  maxReadChars?: number;
  maxListEntries?: number;
  maxTraversalDepth?: number;
  maxSearchFiles?: number;
  maxSearchMatches?: number;
}

interface ResolvedOptions {
  rootDir: string;
  maxReadChars: number;
  maxListEntries: number;
  maxTraversalDepth: number;
  maxSearchFiles: number;
  maxSearchMatches: number;
}

export function createReadOnlyWorkspaceTools(
  options: ReadOnlyWorkspaceToolsOptions,
): ToolDefinition[] {
  const resolved = resolveOptions(options);
  return [createFsListTool(resolved), createFsReadTool(resolved), createGrepTool(resolved)];
}

function resolveOptions(options: ReadOnlyWorkspaceToolsOptions): ResolvedOptions {
  const rootDir = path.resolve(options.rootDir);
  return {
    rootDir,
    maxReadChars: options.maxReadChars ?? 100_000,
    maxListEntries: options.maxListEntries ?? 1_000,
    maxTraversalDepth: options.maxTraversalDepth ?? 8,
    maxSearchFiles: options.maxSearchFiles ?? 300,
    maxSearchMatches: options.maxSearchMatches ?? 300,
  };
}

function createFsListTool(options: ResolvedOptions): ToolDefinition {
  return {
    name: "fs_list",
    description: "List files/directories under a workspace path (optional recursive traversal).",
    risk: "low",
    tags: ["filesystem", "read-only"],
    capabilities: ["filesystem.read"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
        max_depth: { type: "number" },
        max_entries: { type: "number" },
      },
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input) {
      const requestedPath = readOptionalString(input, "path", ".");
      const recursive = readOptionalBoolean(input, "recursive", false);
      const maxEntries = readOptionalInteger(
        input,
        "max_entries",
        Math.min(200, options.maxListEntries),
        1,
        options.maxListEntries,
      );
      const maxDepth = recursive
        ? readOptionalInteger(input, "max_depth", 3, 0, options.maxTraversalDepth)
        : 0;

      const root = resolveWorkspacePath(options.rootDir, requestedPath);
      const rootInfo = await stat(root);
      if (!rootInfo.isDirectory()) {
        throw new Error(`fs_list: path must be a directory: ${requestedPath}`);
      }

      const entries: Array<{
        path: string;
        type: "file" | "directory" | "other";
        sizeBytes?: number;
      }> = [];
      const queue: Array<{ absolutePath: string; depth: number }> = [
        { absolutePath: root, depth: 0 },
      ];

      while (queue.length > 0 && entries.length < maxEntries) {
        const current = queue.shift() as { absolutePath: string; depth: number };
        const dirEntries = await readdir(current.absolutePath, { withFileTypes: true });
        for (const entry of dirEntries) {
          const absolutePath = path.join(current.absolutePath, entry.name);
          const relativePath = relativeToRoot(options.rootDir, absolutePath);
          if (entry.isDirectory()) {
            entries.push({ path: relativePath, type: "directory" });
            if (recursive && current.depth < maxDepth) {
              queue.push({ absolutePath, depth: current.depth + 1 });
            }
          } else if (entry.isFile()) {
            const info = await stat(absolutePath);
            entries.push({ path: relativePath, type: "file", sizeBytes: info.size });
          } else {
            entries.push({ path: relativePath, type: "other" });
          }
          if (entries.length >= maxEntries) break;
        }
      }

      return {
        root: relativeToRoot(options.rootDir, root),
        recursive,
        maxDepth,
        total: entries.length,
        truncated: entries.length >= maxEntries,
        entries,
      };
    },
  };
}

function createFsReadTool(options: ResolvedOptions): ToolDefinition {
  return {
    name: "fs_read",
    description: "Read text from a workspace file, optionally slicing by line range.",
    risk: "low",
    tags: ["filesystem", "read-only"],
    capabilities: ["filesystem.read"],
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number" },
        end_line: { type: "number" },
        max_chars: { type: "number" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input, context) {
      const requestedPath = readRequiredString(input, "path", "fs_read");
      const absolutePath = resolveWorkspacePath(options.rootDir, requestedPath);
      const info = await stat(absolutePath);
      if (!info.isFile()) {
        throw new Error(`fs_read: path must be a file: ${requestedPath}`);
      }
      const raw = await readFile(absolutePath, "utf8");
      const lines = raw.split(/\r?\n/);
      const totalLines = lines.length;
      const startLine = readOptionalInteger(input, "start_line", 1, 1, Math.max(1, totalLines));
      const endLine = readOptionalInteger(
        input,
        "end_line",
        totalLines,
        startLine,
        Math.max(startLine, totalLines),
      );
      if (endLine < startLine) {
        throw new Error(`fs_read: end_line (${endLine}) must be >= start_line (${startLine})`);
      }
      const selected = lines.slice(startLine - 1, endLine);
      const maxChars = readOptionalInteger(
        input,
        "max_chars",
        options.maxReadChars,
        1,
        options.maxReadChars,
      );
      const content = selected.join("\n");
      const captured = await captureToolText({
        toolName: "fs_read",
        field: "content",
        content,
        maxInlineChars: maxChars,
        artifacts: context?.outputArtifacts,
      });
      return {
        path: relativeToRoot(options.rootDir, absolutePath),
        startLine,
        endLine,
        totalLines,
        truncated: captured.truncated,
        content: captured.text,
        ...(captured.truncated
          ? {
              omittedChars: captured.omittedChars,
              totalChars: captured.totalChars,
              ...(captured.artifact ? { contentArtifact: captured.artifact } : {}),
            }
          : {}),
      };
    },
  };
}

function createGrepTool(options: ResolvedOptions): ToolDefinition {
  return {
    name: "grep_search",
    description: "Search text content under a workspace path using ripgrep.",
    risk: "low",
    tags: ["filesystem", "search", "read-only"],
    capabilities: ["filesystem.read", "search.text"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        root_path: { type: "string" },
        is_regex: { type: "boolean" },
        case_sensitive: { type: "boolean" },
        max_files: { type: "number" },
        max_matches: { type: "number" },
        max_depth: { type: "number" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "root_path", kind: "file_path" }],
    async execute(input, context) {
      const query = readRequiredString(input, "query", "grep_search");
      const requestedRoot = readOptionalString(input, "root_path", ".");
      const isRegex = readOptionalBoolean(input, "is_regex", false);
      const caseSensitive = readOptionalBoolean(input, "case_sensitive", false);
      const maxFiles = readOptionalInteger(
        input,
        "max_files",
        options.maxSearchFiles,
        1,
        options.maxSearchFiles,
      );
      const maxMatches = readOptionalInteger(
        input,
        "max_matches",
        options.maxSearchMatches,
        1,
        options.maxSearchMatches,
      );
      readOptionalInteger(input, "max_depth", options.maxTraversalDepth, 0, options.maxTraversalDepth);

      const root = resolveWorkspacePath(options.rootDir, requestedRoot);
      const rootInfo = await stat(root);
      const result = await searchWithRg(
        {
          rootDir: options.rootDir,
        },
        rootInfo.isFile() ? root : root,
        query,
        isRegex,
        caseSensitive,
        maxFiles,
        maxMatches,
        context,
      );

      return {
        query,
        isRegex,
        caseSensitive,
        root: relativeToRoot(options.rootDir, root),
        scannedFiles: result.scannedFiles,
        matchedFiles: result.matchedFiles,
        totalMatches: result.matches.length,
        truncated: result.matches.length >= maxMatches,
        matches: result.matches,
        searchBackend: "rg",
      };
    },
  };
}

async function searchWithRg(
  options: { rootDir: string },
  root: string,
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
  maxFiles: number,
  maxMatches: number,
  context?: ToolExecutionContext,
): Promise<{
  scannedFiles: number;
  matchedFiles: number;
  matches: Array<{ file: string; line: number; snippet: string }>;
}> {
  ensureRgAvailable();

  return new Promise((resolve, reject) => {
    const args = [
      "--json",
      "--line-number",
      "--column",
      "--no-heading",
      "--color",
      "never",
      "--hidden",
    ];
    if (!caseSensitive) args.push("-i");
    if (!isRegex) args.push("-F");
    args.push(query);
    args.push(root);

    const child = spawn("rg", args, {
      cwd: options.rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    const matches: Array<{ file: string; line: number; snippet: string }> = [];
    const seenFiles = new Set<string>();
    let scannedFiles = 0;
    let matchedFiles = 0;
    let stderr = "";
    let buffer = "";
    let settled = false;

    const finish = (fn: (value: any) => void, value?: unknown): void => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const parseEvent = (line: string): void => {
      if (!line || matches.length >= maxMatches) return;
      const parsed = JSON.parse(line) as {
        type: string;
        data?: {
          path?: { text?: string };
          line_number?: number;
          lines?: { text?: string };
        };
      };
      if (parsed.type === "begin") {
        scannedFiles += 1;
        if (scannedFiles >= maxFiles) {
          child.kill("SIGTERM");
        }
        return;
      }
      if (parsed.type !== "match") return;
      const file = parsed.data?.path?.text;
      if (!file) return;
      if (!seenFiles.has(file)) {
        seenFiles.add(file);
        matchedFiles += 1;
      }
      matches.push({
        file: relativeToRoot(options.rootDir, path.resolve(options.rootDir, file)),
        line: parsed.data?.line_number ?? 0,
        snippet: truncate(parsed.data?.lines?.text ?? "", 240),
      });
      if (matches.length >= maxMatches) {
        child.kill("SIGTERM");
      }
    };

    child.stdout?.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);
        try {
          parseEvent(line);
        } catch (error) {
          child.kill("SIGTERM");
          finish(reject, error);
          return;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      finish(reject, error);
    });

    child.once("close", (code, signal) => {
      if (settled) return;
      if (code === 0 || code === 1 || signal === "SIGTERM") {
        finish(resolve, { scannedFiles, matchedFiles, matches });
        return;
      }
      const message = stderr.trim() || `rg exited with code ${code ?? "unknown"}`;
      finish(reject, new Error(message));
    });
  });
}

function ensureRgAvailable(): void {
  const result = spawnSync("rg", ["--version"], { stdio: "ignore" });
  if (result.status === 0 && !result.error) return;
  throw new Error("grep_search requires `rg` to be installed and available on PATH");
}
