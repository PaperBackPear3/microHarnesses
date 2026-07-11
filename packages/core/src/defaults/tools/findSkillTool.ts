import { readOptionalInteger, readRequiredString } from "../../shared/inputParsing";
import type { SkillDefinition } from "../../skills/types";
import type { SkillRegistry } from "../../skills/registry";
import type { ToolDefinition } from "../../tools/types";

const MAX_RESULTS = 50;

export function createFindSkillTool(skills: SkillRegistry): ToolDefinition {
  return {
    name: "find_skill",
    description:
      "Finds relevant skills by searching skill name, description, tags, and capabilities.",
    risk: "low",
    tags: ["skills", "discovery", "search"],
    capabilities: ["skills.read"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for matching skills." },
        limit: { type: "number", description: `Maximum matches to return (1-${MAX_RESULTS}).` },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input) {
      const query = readRequiredString(input, "query", "find_skill").toLowerCase();
      const limit = readOptionalInteger(input, "limit", 10, 1, MAX_RESULTS);
      const matches = skills
        .list()
        .filter((skill) => matchesSkill(skill, query))
        .slice(0, limit)
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          ...(skill.tags && skill.tags.length > 0 ? { tags: skill.tags } : {}),
          ...(skill.capabilities && skill.capabilities.length > 0
            ? { capabilities: skill.capabilities }
            : {}),
        }));
      return { skills: matches, total: matches.length };
    },
  };
}

function matchesSkill(skill: SkillDefinition, query: string): boolean {
  if (skill.name.toLowerCase().includes(query)) return true;
  if (skill.description.toLowerCase().includes(query)) return true;
  if ((skill.tags ?? []).some((tag) => tag.toLowerCase().includes(query))) return true;
  if ((skill.capabilities ?? []).some((capability) => capability.toLowerCase().includes(query))) {
    return true;
  }
  return false;
}
