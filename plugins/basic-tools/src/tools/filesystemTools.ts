import { appendFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ToolDefinition, isNodeError } from "@micro-harnesses/core";
import type { BasicToolsResolvedOptions } from "../options";
import {
  parseOptionalBoolean,
  parseRequiredString,
  parseRequiredText,
  relativeToRoot,
  resolveWorkspacePath,
} from "../utils";

export function createFilesystemTools(options: BasicToolsResolvedOptions): ToolDefinition[] {
  return [
    createFsWriteTool(options),
    createFsAppendTool(options),
    createFsMkdirTool(options),
    createFsMoveTool(options),
    createFsRemoveTool(options),
  ];
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
        create_parents: {
          type: "boolean",
          description: "Create parent directories if missing.",
        },
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
        create_parents: {
          type: "boolean",
          description: "Create parent directories if missing.",
        },
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
        path: {
          type: "string",
          description: "Workspace-relative directory path.",
        },
        recursive: {
          type: "boolean",
          description: "Whether to create intermediate directories.",
        },
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
      return {
        path: relativeToRoot(options.rootDir, absolutePath),
        recursive,
        created: true,
      };
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
        src_path: {
          type: "string",
          description: "Workspace-relative source path.",
        },
        dst_path: {
          type: "string",
          description: "Workspace-relative destination path.",
        },
        overwrite: {
          type: "boolean",
          description: "Whether to replace destination if it exists.",
        },
        create_parents: {
          type: "boolean",
          description: "Create destination parent directories.",
        },
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
        path: {
          type: "string",
          description: "Workspace-relative path to remove.",
        },
        recursive: {
          type: "boolean",
          description: "Required for directories.",
        },
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
