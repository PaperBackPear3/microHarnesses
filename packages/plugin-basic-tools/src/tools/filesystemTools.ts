import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { type ToolDefinition, isNodeError } from "@micro-harness/core";
import type { BasicToolsResolvedOptions } from "../options";
import {
  parseOptionalBoolean,
  parseOptionalInteger,
  parseOptionalString,
  parseRequiredString,
  parseRequiredText,
  relativeToRoot,
  resolveWorkspacePath,
} from "../utils";

interface QueueItem {
  absolutePath: string;
  depth: number;
}

export function createFilesystemTools(options: BasicToolsResolvedOptions): ToolDefinition[] {
  return [
    createFsListTool(options),
    createFsReadTool(options),
    createFsWriteTool(options),
    createFsAppendTool(options),
    createFsMkdirTool(options),
    createFsMoveTool(options),
    createFsRemoveTool(options),
  ];
}

function createFsListTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "fs_list",
    description: "List files/directories under a workspace path (optional recursive traversal).",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to list (default: .)." },
        recursive: { type: "boolean", description: "Whether to traverse recursively." },
        max_depth: { type: "number", description: "Maximum recursion depth when recursive=true." },
        max_entries: { type: "number", description: "Maximum entries returned." },
      },
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input) {
      const requestedPath = parseOptionalString(input, "path", ".");
      const recursive = parseOptionalBoolean(input, "recursive", false);
      const maxEntries = parseOptionalInteger(
        input,
        "max_entries",
        Math.min(200, options.maxListEntries),
        1,
        options.maxListEntries,
      );
      const maxDepth = recursive
        ? parseOptionalInteger(input, "max_depth", 3, 0, options.maxTraversalDepth)
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

      const queue: QueueItem[] = [{ absolutePath: root, depth: 0 }];
      while (queue.length > 0 && entries.length < maxEntries) {
        const current = queue.shift() as QueueItem;
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
          if (entries.length >= maxEntries) {
            break;
          }
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

function createFsReadTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "fs_read",
    description: "Read text from a workspace file, optionally slicing by line range.",
    risk: "low",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        start_line: { type: "number", description: "1-based start line (inclusive)." },
        end_line: { type: "number", description: "1-based end line (inclusive)." },
        max_chars: { type: "number", description: "Maximum returned characters." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input) {
      const requestedPath = parseRequiredString(input, "path", "fs_read");
      const absolutePath = resolveWorkspacePath(options.rootDir, requestedPath);
      const info = await stat(absolutePath);
      if (!info.isFile()) {
        throw new Error(`fs_read: path must be a file: ${requestedPath}`);
      }
      const raw = await readFile(absolutePath, "utf8");
      const lines = raw.split(/\r?\n/);
      const totalLines = lines.length;
      const startLine = parseOptionalInteger(input, "start_line", 1, 1, Math.max(1, totalLines));
      const endLine = parseOptionalInteger(
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
      const maxChars = parseOptionalInteger(
        input,
        "max_chars",
        options.maxReadChars,
        1,
        options.maxReadChars,
      );
      const content = selected.join("\n");
      const truncated = content.length > maxChars;
      return {
        path: relativeToRoot(options.rootDir, absolutePath),
        startLine,
        endLine,
        totalLines,
        truncated,
        content: truncated ? content.slice(0, maxChars) : content,
      };
    },
  };
}

function createFsWriteTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "fs_write",
    description: "Write text to a workspace file (overwrite).",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        content: { type: "string", description: "Text content to write." },
        create_parents: { type: "boolean", description: "Create parent directories if missing." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input) {
      const requestedPath = parseRequiredString(input, "path", "fs_write");
      const content = parseRequiredText(input, "content", "fs_write");
      const createParents = parseOptionalBoolean(input, "create_parents", false);
      const absolutePath = resolveWorkspacePath(options.rootDir, requestedPath);
      if (createParents) {
        await mkdir(path.dirname(absolutePath), { recursive: true });
      }
      await writeFile(absolutePath, content, "utf8");
      return {
        path: relativeToRoot(options.rootDir, absolutePath),
        bytesWritten: Buffer.byteLength(content, "utf8"),
      };
    },
  };
}

function createFsAppendTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "fs_append",
    description: "Append text to a workspace file.",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        content: { type: "string", description: "Text content to append." },
        create_parents: { type: "boolean", description: "Create parent directories if missing." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input) {
      const requestedPath = parseRequiredString(input, "path", "fs_append");
      const content = parseRequiredText(input, "content", "fs_append");
      const createParents = parseOptionalBoolean(input, "create_parents", false);
      const absolutePath = resolveWorkspacePath(options.rootDir, requestedPath);
      if (createParents) {
        await mkdir(path.dirname(absolutePath), { recursive: true });
      }
      await appendFile(absolutePath, content, "utf8");
      return {
        path: relativeToRoot(options.rootDir, absolutePath),
        bytesAppended: Buffer.byteLength(content, "utf8"),
      };
    },
  };
}

function createFsMkdirTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "fs_mkdir",
    description: "Create a directory inside the workspace.",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative directory path." },
        recursive: { type: "boolean", description: "Whether to create intermediate directories." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input) {
      const requestedPath = parseRequiredString(input, "path", "fs_mkdir");
      const recursive = parseOptionalBoolean(input, "recursive", true);
      const absolutePath = resolveWorkspacePath(options.rootDir, requestedPath);
      await mkdir(absolutePath, { recursive });
      return { path: relativeToRoot(options.rootDir, absolutePath), recursive, created: true };
    },
  };
}

function createFsMoveTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "fs_move",
    description: "Move or rename a workspace file/directory.",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        src_path: { type: "string", description: "Workspace-relative source path." },
        dst_path: { type: "string", description: "Workspace-relative destination path." },
        overwrite: { type: "boolean", description: "Whether to replace destination if it exists." },
        create_parents: { type: "boolean", description: "Create destination parent directories." },
      },
      required: ["src_path", "dst_path"],
      additionalProperties: false,
    },
    inputAnnotations: [
      { field: "src_path", kind: "file_path" },
      { field: "dst_path", kind: "file_path" },
    ],
    async execute(input) {
      const srcPath = parseRequiredString(input, "src_path", "fs_move");
      const dstPath = parseRequiredString(input, "dst_path", "fs_move");
      const overwrite = parseOptionalBoolean(input, "overwrite", false);
      const createParents = parseOptionalBoolean(input, "create_parents", false);
      const srcAbsolute = resolveWorkspacePath(options.rootDir, srcPath);
      const dstAbsolute = resolveWorkspacePath(options.rootDir, dstPath);
      if (createParents) {
        await mkdir(path.dirname(dstAbsolute), { recursive: true });
      }
      if (!overwrite) {
        try {
          await stat(dstAbsolute);
          throw new Error(`fs_move: destination already exists: ${dstPath}`);
        } catch (error: unknown) {
          if (error instanceof Error && error.message.startsWith("fs_move: destination")) {
            throw error;
          }
          if (!isNodeError(error) || error.code !== "ENOENT") {
            throw error;
          }
        }
      } else {
        await rm(dstAbsolute, { recursive: true, force: true });
      }
      await rename(srcAbsolute, dstAbsolute);
      return {
        srcPath: relativeToRoot(options.rootDir, srcAbsolute),
        dstPath: relativeToRoot(options.rootDir, dstAbsolute),
        overwrite,
      };
    },
  };
}

function createFsRemoveTool(options: BasicToolsResolvedOptions): ToolDefinition {
  return {
    name: "fs_remove",
    description: "Remove a workspace file or directory.",
    risk: "high",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to remove." },
        recursive: { type: "boolean", description: "Required for directories." },
        force: { type: "boolean", description: "Ignore non-existing targets." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    inputAnnotations: [{ field: "path", kind: "file_path" }],
    async execute(input) {
      const requestedPath = parseRequiredString(input, "path", "fs_remove");
      const recursive = parseOptionalBoolean(input, "recursive", false);
      const force = parseOptionalBoolean(input, "force", false);
      const absolutePath = resolveWorkspacePath(options.rootDir, requestedPath);
      try {
        const info = await stat(absolutePath);
        if (info.isDirectory() && !recursive) {
          throw new Error(
            `fs_remove: "${requestedPath}" is a directory; set recursive=true to remove`,
          );
        }
      } catch (error: unknown) {
        if (!isNodeError(error) || error.code !== "ENOENT" || !force) {
          throw error;
        }
      }
      await rm(absolutePath, { recursive, force });
      return {
        path: relativeToRoot(options.rootDir, absolutePath),
        recursive,
        force,
        removed: true,
      };
    },
  };
}
