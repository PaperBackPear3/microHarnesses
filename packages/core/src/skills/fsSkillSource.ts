import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isNodeError } from "../shared/nodeError";
import { truncate } from "../shared/text";
import type { SkillDefinition } from "./types";

export interface FsSkillSourceOptions {
  rootDir: string;
  /** Maximum characters of SKILL.md instructions returned per execution. Default: 100_000. */
  maxInstructionChars?: number;
}

interface SkillMetadata {
  name: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  risk?: "low" | "high";
}

const SKILL_FILE = "SKILL.md";
const META_FILE = "skill.meta.json";

/**
 * Loads executable skills from the filesystem. Each skill is a directory under
 * `rootDir` containing:
 *
 * - `SKILL.md` — the skill instructions (required to be loadable);
 * - `skill.meta.json` — optional metadata `{ description, tags, capabilities, risk }`;
 * - any other files, exposed to the model as listed resources.
 *
 * Skills follow the prompt-expansion model: `execute()` returns the skill
 * instructions plus the relative paths of bundled resource files, which the
 * model can then read with its regular file tools.
 */
export class FsSkillSource {
  private readonly rootDir: string;
  private readonly maxInstructionChars: number;

  constructor(options: FsSkillSourceOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.maxInstructionChars = options.maxInstructionChars ?? 100_000;
  }

  async listSkillNames(): Promise<string[]> {
    try {
      const entries = await readdir(this.rootDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async readSkillMetadata(skillName: string): Promise<SkillMetadata> {
    const metadataPath = path.join(this.rootDir, skillName, META_FILE);
    try {
      const raw = await readFile(metadataPath, "utf8");
      const parsed = JSON.parse(raw) as Omit<SkillMetadata, "name">;
      return {
        name: skillName,
        description: parsed.description,
        tags: parsed.tags,
        capabilities: parsed.capabilities,
        risk: parsed.risk,
      };
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { name: skillName };
      }
      throw error;
    }
  }

  /** Loads one skill directory into an executable SkillDefinition. */
  async load(skillName: string): Promise<SkillDefinition> {
    const skillDir = path.join(this.rootDir, skillName);
    const meta = await this.readSkillMetadata(skillName);
    const instructions = await this.readInstructions(skillDir);
    if (instructions === undefined) {
      throw new Error(`Skill "${skillName}" has no ${SKILL_FILE} in ${skillDir}`);
    }
    const description = meta.description ?? firstParagraph(instructions) ?? `Skill ${meta.name}`;
    const maxChars = this.maxInstructionChars;

    return {
      name: meta.name,
      description,
      tags: meta.tags ?? [],
      capabilities: meta.capabilities,
      risk: meta.risk ?? "low",
      async execute() {
        const resources = await listResourceFiles(skillDir);
        return {
          skill: meta.name,
          instructions: truncate(instructions, maxChars),
          ...(resources.length > 0 ? { resources } : {}),
        };
      },
    };
  }

  /** Loads every skill directory that contains a SKILL.md, skipping the rest. */
  async loadAll(): Promise<SkillDefinition[]> {
    const names = await this.listSkillNames();
    const skills: SkillDefinition[] = [];
    for (const name of names) {
      const instructions = await this.readInstructions(path.join(this.rootDir, name));
      if (instructions === undefined) continue;
      skills.push(await this.load(name));
    }
    return skills;
  }

  private async readInstructions(skillDir: string): Promise<string | undefined> {
    try {
      return await readFile(path.join(skillDir, SKILL_FILE), "utf8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }
}

async function listResourceFiles(skillDir: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [skillDir];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === SKILL_FILE || entry.name === META_FILE) continue;
      out.push(path.relative(skillDir, absolute));
    }
  }
  return out.sort();
}

function firstParagraph(markdown: string): string | undefined {
  for (const block of markdown.split(/\r?\n\r?\n/)) {
    const text = block
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("#"))
      .join(" ")
      .trim();
    if (text.length > 0) {
      return truncate(text, 300);
    }
  }
  return undefined;
}
