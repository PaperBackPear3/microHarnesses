import path from "node:path";
import { readOptionalJsonFile, readOptionalTextFile, resolveSourceRoot } from "../shared/fsSource";
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
    this.rootDir = resolveSourceRoot(options.rootDir);
    this.sections = options.sections ?? ["developer", "tools"];
    this.strictVariables = options.strictVariables ?? false;
  }

  async load(
    promptName: string,
    task: string,
    variables: Record<string, string> = {},
  ): Promise<PromptBundle> {
    const base = safeResolve(this.rootDir, promptName);
    const systemRaw = await readOptionalTextFile(path.join(base, "system.md"));
    if (systemRaw === undefined) {
      throw new Error(`Missing required prompt file: ${path.join(base, "system.md")}`);
    }
    const optionalSections = await Promise.all(
      this.sections.map(async (section) => ({
        section,
        raw: await readOptionalTextFile(path.join(base, `${section}.md`)),
      })),
    );
    const metadata = await readMetadata(path.join(base, "prompt.meta.json"), promptName);

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

async function readMetadata(filePath: string, promptName: string): Promise<PromptMetadata> {
  const parsed = await readOptionalJsonFile<PromptMetadata>(filePath);
  if (!parsed) {
    return { name: promptName };
  }
  return {
    name: parsed.name ?? promptName,
    modelHint: parsed.modelHint,
    taskTypeHint:
      parsed.taskTypeHint === "default" ||
      parsed.taskTypeHint === "reasoning" ||
      parsed.taskTypeHint === "fast"
        ? parsed.taskTypeHint
        : undefined,
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
