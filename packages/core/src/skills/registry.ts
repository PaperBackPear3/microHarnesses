import { DuplicateSkillError, UnknownSkillError } from "../shared/errors";
import type { SkillCatalogQuery, SkillDefinition } from "./types";

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.name)) {
      throw new DuplicateSkillError(`Skill "${skill.name}" is already registered`);
    }
    this.skills.set(skill.name, skill);
  }

  get(name: string): SkillDefinition {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new UnknownSkillError(`Unknown skill: "${name}"`);
    }
    return skill;
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  catalog(query: SkillCatalogQuery = {}): SkillDefinition[] {
    return this.list().filter((skill) => {
      if (query.tag && !(skill.tags ?? []).includes(query.tag)) {
        return false;
      }
      if (query.capability && !(skill.capabilities ?? []).includes(query.capability)) {
        return false;
      }
      return true;
    });
  }
}
