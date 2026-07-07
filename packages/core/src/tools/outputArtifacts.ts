import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { clampNumber } from "../shared/inputParsing";
import { safeResolve } from "../shared/paths";

export interface ToolOutputArtifactsOptions {
  rootDir: string;
  maxStoredChars?: number;
}

export interface ToolOutputArtifactRef {
  id: string;
  /** Relative path under the tool output artifact root. */
  path: string;
  totalChars: number;
  storedChars: number;
  storageTruncated: boolean;
}

export interface ToolTextPreview {
  text: string;
  truncated: boolean;
  visibleChars: number;
  totalChars: number;
  omittedChars: number;
}

export interface CapturedToolText {
  text: string;
  truncated: boolean;
  totalChars: number;
  omittedChars: number;
  artifact?: ToolOutputArtifactRef;
}

export interface CaptureToolTextInput {
  toolName: string;
  field: string;
  content: string;
  totalChars?: number;
  maxInlineChars: number;
  artifacts?: ToolOutputArtifacts;
}

const DEFAULT_MAX_STORED_CHARS = 2_000_000;
const TRUNCATION_MARKER = "\n… [truncated] …\n";

export class ToolOutputArtifacts {
  private readonly rootDir: string;
  private readonly maxStoredChars: number;

  constructor(options: ToolOutputArtifactsOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.maxStoredChars = clampNumber(
      options.maxStoredChars,
      1_000,
      20_000_000,
      DEFAULT_MAX_STORED_CHARS,
    );
  }

  async writeText(input: {
    toolName: string;
    field: string;
    content: string;
    totalChars?: number;
  }): Promise<ToolOutputArtifactRef> {
    await mkdir(this.rootDir, { recursive: true });
    const id = randomUUID();
    const fileName = `${id}.txt`;
    const absolutePath = path.join(this.rootDir, fileName);
    const totalChars = Math.max(input.content.length, input.totalChars ?? input.content.length);
    const storageTruncated = totalChars > this.maxStoredChars;
    const stored = storageTruncated ? input.content.slice(0, this.maxStoredChars) : input.content;
    await writeFile(absolutePath, stored, "utf8");
    return {
      id,
      path: fileName,
      totalChars,
      storedChars: stored.length,
      storageTruncated,
    };
  }

  async readText(input: {
    id?: string;
    path?: string;
    offset?: number;
    maxChars?: number;
    startLine?: number;
    endLine?: number;
  }): Promise<{
    path: string;
    totalChars: number;
    startOffset?: number;
    endOffset?: number;
    startLine?: number;
    endLine?: number;
    totalLines?: number;
    truncated: boolean;
    content: string;
  }> {
    const { path: relativePath, absolutePath } = this.resolveReadPath(input.id, input.path);
    const raw = await readFile(absolutePath, "utf8");
    if (
      typeof input.startLine === "number" ||
      typeof input.endLine === "number"
    ) {
      const lines = raw.split(/\r?\n/);
      const totalLines = lines.length;
      const startLine = clampNumber(input.startLine, 1, Math.max(1, totalLines), 1);
      const endLine = clampNumber(input.endLine, startLine, Math.max(startLine, totalLines), totalLines);
      const selected = lines.slice(startLine - 1, endLine).join("\n");
      return {
        path: relativePath,
        totalChars: raw.length,
        startLine,
        endLine,
        totalLines,
        truncated: selected.length < raw.length,
        content: selected,
      };
    }

    const offset = clampNumber(input.offset, 0, raw.length, 0);
    const requestedChars = clampNumber(input.maxChars, 1, this.maxStoredChars, 40_000);
    const content = raw.slice(offset, offset + requestedChars);
    return {
      path: relativePath,
      totalChars: raw.length,
      startOffset: offset,
      endOffset: offset + content.length,
      truncated: offset + content.length < raw.length,
      content,
    };
  }

  async stat(input: { id?: string; path?: string }): Promise<{
    path: string;
    bytes: number;
  }> {
    const { path: relativePath, absolutePath } = this.resolveReadPath(input.id, input.path);
    const info = await stat(absolutePath);
    return { path: relativePath, bytes: info.size };
  }

  private resolveReadPath(
    id: string | undefined,
    requestedPath: string | undefined,
  ): { path: string; absolutePath: string } {
    if (typeof id === "string" && id.trim().length > 0) {
      const fileName = `${id.trim()}.txt`;
      return { path: fileName, absolutePath: path.join(this.rootDir, fileName) };
    }
    if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
      throw new Error('tool_output_read: provide either "id" or "path"');
    }
    const resolved = safeResolve(this.rootDir, requestedPath);
    return { path: requestedPath, absolutePath: resolved };
  }
}

export async function captureToolText(input: CaptureToolTextInput): Promise<CapturedToolText> {
  const preview = createToolTextPreview(input.content, input.maxInlineChars);
  const totalChars = Math.max(input.content.length, input.totalChars ?? input.content.length);
  const sourceTailOmitted = Math.max(0, totalChars - input.content.length);
  const omittedChars = preview.omittedChars + sourceTailOmitted;
  const truncated = preview.truncated || sourceTailOmitted > 0;
  if (!truncated) {
    return {
      text: preview.text,
      truncated: false,
      totalChars,
      omittedChars: 0,
    };
  }
  const artifact = input.artifacts
    ? await input.artifacts.writeText({
        toolName: input.toolName,
        field: input.field,
        content: input.content,
        totalChars,
      })
    : undefined;
  return {
    text: preview.text,
    truncated,
    totalChars,
    omittedChars,
    ...(artifact ? { artifact } : {}),
  };
}

export function createToolTextPreview(text: string, maxInlineChars: number): ToolTextPreview {
  const bounded = clampNumber(maxInlineChars, 1, 2_000_000, 40_000);
  if (text.length <= bounded) {
    return {
      text,
      truncated: false,
      visibleChars: text.length,
      totalChars: text.length,
      omittedChars: 0,
    };
  }
  if (bounded <= TRUNCATION_MARKER.length + 2) {
    const clipped = text.slice(0, bounded);
    return {
      text: clipped,
      truncated: true,
      visibleChars: clipped.length,
      totalChars: text.length,
      omittedChars: Math.max(0, text.length - clipped.length),
    };
  }
  const available = bounded - TRUNCATION_MARKER.length;
  const headLength = Math.ceil(available * 0.7);
  const tailLength = Math.max(1, available - headLength);
  const head = text.slice(0, headLength);
  const tail = text.slice(text.length - tailLength);
  const rendered = `${head}${TRUNCATION_MARKER}${tail}`;
  return {
    text: rendered,
    truncated: true,
    visibleChars: head.length + tail.length,
    totalChars: text.length,
    omittedChars: Math.max(0, text.length - head.length - tail.length),
  };
}
