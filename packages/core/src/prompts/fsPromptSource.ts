import { readFile } from "node:fs/promises";
import path from "node:path";
import { PromptBundle, PromptMetadata, PromptSource } from "../types";

export interface FsPromptSourceOptions {
  rootDir: string;
}

export class FsPromptSource implements PromptSource {
  private readonly rootDir: string;

  constructor(options: FsPromptSourceOptions) {
    this.rootDir = options.rootDir;
  }

  async load(agentName: string, task: string, variables: Record<string, string> = {}): Promise<PromptBundle> {
    const base = path.join(this.rootDir, agentName);
    const systemRaw = await readFile(path.join(base, "system.md"), "utf8");
    const developerRaw = await readOptional(path.join(base, "developer.md"));
    const toolsRaw = await readOptional(path.join(base, "tools.md"));
    const metadata = await readMetadata(path.join(base, "prompt.meta.json"), agentName);

    const system = renderTemplate(stripFrontmatter(systemRaw), variables);
    const developer = developerRaw ? renderTemplate(stripFrontmatter(developerRaw), variables) : undefined;
    const tools = toolsRaw ? renderTemplate(stripFrontmatter(toolsRaw), variables) : undefined;

    return {
      system,
      developer,
      tools,
      task: renderTemplate(task, variables),
      metadata
    };
  }
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}

async function readMetadata(filePath: string, agentName: string): Promise<PromptMetadata> {
  const raw = await readOptional(filePath);
  if (!raw) {
    return { name: agentName };
  }
  const parsed = JSON.parse(raw) as PromptMetadata;
  return {
    name: parsed.name ?? agentName,
    modelHint: parsed.modelHint,
    safetyMode: parsed.safetyMode,
    tags: parsed.tags
  };
}

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }
  const endIndex = markdown.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return markdown;
  }
  return markdown.slice(endIndex + 5);
}

function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => variables[key] ?? "");
}
