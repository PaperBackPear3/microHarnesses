import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { safeResolve } from "../../shared/paths";
import { truncate } from "../../shared/text";
import type { ToolDefinition } from "../../tools/types";

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
    async execute(input) {
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
      const truncatedFlag = content.length > maxChars;
      return {
        path: relativeToRoot(options.rootDir, absolutePath),
        startLine,
        endLine,
        totalLines,
        truncated: truncatedFlag,
        content: truncatedFlag ? content.slice(0, maxChars) : content,
      };
    },
  };
}

function createGrepTool(options: ResolvedOptions): ToolDefinition {
  return {
    name: "grep_search",
    description: "Search text content under a workspace path using literal or regex matching.",
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
    async execute(input) {
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
      const maxDepth = readOptionalInteger(
        input,
        "max_depth",
        options.maxTraversalDepth,
        0,
        options.maxTraversalDepth,
      );

      const root = resolveWorkspacePath(options.rootDir, requestedRoot);
      const rootInfo = await stat(root);
      const files = rootInfo.isFile() ? [root] : await collectFiles(root, maxDepth, maxFiles);
      const matcher = buildMatcher(query, isRegex, caseSensitive);
      const matches: Array<{ file: string; line: number; snippet: string }> = [];
      let scannedFiles = 0;
      let matchedFiles = 0;

      for (const filePath of files) {
        if (matches.length >= maxMatches) break;
        const fileMatches = await findMatchesInFile(
          filePath,
          matcher,
          maxMatches - matches.length,
          options.maxReadChars,
        );
        scannedFiles += 1;
        if (fileMatches.length > 0) {
          matchedFiles += 1;
          for (const match of fileMatches) {
            matches.push({
              file: relativeToRoot(options.rootDir, filePath),
              line: match.line,
              snippet: truncate(match.snippet, 240),
            });
            if (matches.length >= maxMatches) break;
          }
        }
      }

      return {
        query,
        isRegex,
        caseSensitive,
        root: relativeToRoot(options.rootDir, root),
        scannedFiles,
        matchedFiles,
        totalMatches: matches.length,
        truncated: matches.length >= maxMatches,
        matches,
      };
    },
  };
}

async function collectFiles(root: string, maxDepth: number, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ absolutePath: string; depth: number }> = [{ absolutePath: root, depth: 0 }];
  while (queue.length > 0 && out.length < maxFiles) {
    const current = queue.shift() as { absolutePath: string; depth: number };
    const entries = await readdir(current.absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) {
          queue.push({ absolutePath, depth: current.depth + 1 });
        }
        continue;
      }
      if (entry.isFile()) {
        out.push(absolutePath);
        if (out.length >= maxFiles) break;
      }
    }
  }
  return out;
}

function buildMatcher(
  query: string,
  isRegex: boolean,
  caseSensitive: boolean,
): (line: string) => boolean {
  if (!isRegex) {
    const expected = caseSensitive ? query : query.toLowerCase();
    return (line) => (caseSensitive ? line : line.toLowerCase()).includes(expected);
  }
  const flags = caseSensitive ? "" : "i";
  const regex = new RegExp(query, flags);
  return (line) => regex.test(line);
}

async function findMatchesInFile(
  filePath: string,
  matcher: (line: string) => boolean,
  maxMatches: number,
  maxReadChars: number,
): Promise<Array<{ line: number; snippet: string }>> {
  const content = await readFile(filePath, "utf8");
  const sliced = content.length > maxReadChars ? content.slice(0, maxReadChars) : content;
  const lines = sliced.split(/\r?\n/);
  const matches: Array<{ line: number; snippet: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (!matcher(line)) continue;
    matches.push({ line: index + 1, snippet: line });
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

function readRequiredString(input: Record<string, unknown>, key: string, toolName: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${toolName}: "${key}" must be a non-empty string`);
  }
  return value;
}

function readOptionalString(input: Record<string, unknown>, key: string, fallback: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return value;
}

function readOptionalBoolean(
  input: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

function readOptionalInteger(
  input: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(input[key]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const parsed = Math.floor(value);
  return Math.min(max, Math.max(min, parsed));
}

function resolveWorkspacePath(rootDir: string, requestedPath: string): string {
  return safeResolve(rootDir, requestedPath);
}

function relativeToRoot(rootDir: string, absolutePath: string): string {
  const relative = path.relative(rootDir, absolutePath);
  return relative.length === 0 ? "." : relative;
}
