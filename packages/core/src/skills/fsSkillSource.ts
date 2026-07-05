import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isNodeError } from "../shared/nodeError";
import type { SkillDefinition } from "./types";

export interface FsSkillSourceOptions {
  rootDir: string;
}

export class FsSkillSource {
  private readonly rootDir: string;

  constructor(options: FsSkillSourceOptions) {
    this.rootDir = path.resolve(options.rootDir);
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

  /**
   * Scaffold loader for skill metadata. Execution behavior remains supplied
   * by registered `SkillDefinition`s, not by this source.
   */
  async readSkillMetadata(
    skillName: string,
  ): Promise<{ name: string; description?: string; tags?: string[] }> {
    const metadataPath = path.join(this.rootDir, skillName, "skill.meta.json");
    try {
      const raw = await readFile(metadataPath, "utf8");
      const parsed = JSON.parse(raw) as { description?: string; tags?: string[] };
      return { name: skillName, description: parsed.description, tags: parsed.tags };
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { name: skillName };
      }
      throw error;
    }
  }

  async toDefinitionSkeleton(skillName: string): Promise<SkillDefinition> {
    const meta = await this.readSkillMetadata(skillName);
    return {
      name: meta.name,
      description: meta.description ?? `Skill ${meta.name}`,
      tags: meta.tags ?? [],
      async execute() {
        return { message: "Skill execution not implemented in FsSkillSource skeleton" };
      },
    };
  }
}
