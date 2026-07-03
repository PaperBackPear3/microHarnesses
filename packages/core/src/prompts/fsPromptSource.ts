import { readFile } from "node:fs/promises";
import path from "node:path";
import { isNodeError } from "../shared/nodeError";
import { safeResolve } from "../shared/paths";
import type { PromptBundle, PromptInstruction, PromptMetadata, PromptSource } from "./types";

export interface FsPromptSourceOptions {
  rootDir: string;
  sections?: string[];
  strictVariables?: boolean;
}

export class FsPromptSource implements PromptSource {
  private readonly rootDir: string;
  private readonly sections: string[];
  private readonly strictVariables: boolean;

  constructor(options: FsPromptSourceOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.sections = options.sections ?? ["developer", "tools"];
    this.strictVariables = options.strictVariables ?? false;
  }

  async load(
    agentName: string,
    task: string,
    variables: Record<string, string> = {},
  ): Promise<PromptBundle> {
    const base = safeResolve(this.rootDir, agentName);
    const systemRaw = await readFile(path.join(base, "system.md"), "utf8");
    const optionalSections = await Promise.all(
      this.sections.map(async (section) => ({
        section,
        raw: await readOptional(path.join(base, `${section}.md`)),
      })),
    );
    const metadata = await readMetadata(path.join(base, "prompt.meta.json"), agentName);

    const system = renderTemplate(stripFrontmatter(systemRaw), variables, this.strictVariables);
    const instructions: PromptInstruction[] = optionalSections
      .filter((entry) => Boolean(entry.raw))
      .map((entry) => {
        const rendered = renderTemplate(
          stripFrontmatter(entry.raw as string),
          variables,
          this.strictVariables,
        );
        const role =
          entry.section === "developer" || entry.section === "tools" ? entry.section : "custom";
        return {
          role,
          name: entry.section,
          content: rendered,
        };
      });

    return {
      system,
      instructions,
      task: renderTemplate(task, variables, this.strictVariables),
      metadata,
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
    tags: parsed.tags,
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

function renderTemplate(
  text: string,
  variables: Record<string, string>,
  strictVariables: boolean,
): string {
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return variables[key] as string;
    }
    if (strictVariables) {
      throw new Error(`Missing template variable: ${key}`);
    }
    process.stderr.write(`Warning: missing template variable "${key}"\n`);
    return "";
  });
}
