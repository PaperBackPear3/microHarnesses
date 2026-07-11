import { readOptionalInteger, readOptionalString } from "../../shared/inputParsing";
import type { SkillRegistry } from "../../skills/registry";
import type { ToolDefinition } from "../../tools/types";

const MAX_RESULTS = 100;

export function createListSkillsTool(skills: SkillRegistry): ToolDefinition {
  return {
    name: "list_skills",
    description:
      "Lists registered skills so you can choose one before execution. " +
      "Use optional tag/capability filters to narrow results.",
    risk: "low",
    tags: ["skills", "discovery"],
    capabilities: ["skills.read"],
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Optional tag filter." },
        capability: { type: "string", description: "Optional capability filter." },
        limit: { type: "number", description: `Maximum skills to return (1-${MAX_RESULTS}).` },
      },
      additionalProperties: false,
    },
    async execute(input) {
      const tag = readOptionalString(input, "tag", "");
      const capability = readOptionalString(input, "capability", "");
      const limit = readOptionalInteger(input, "limit", 25, 1, MAX_RESULTS);
      const all = skills.catalog({
        ...(tag ? { tag } : {}),
        ...(capability ? { capability } : {}),
      });
      const items = all.slice(0, limit).map((skill) => ({
        name: skill.name,
        description: skill.description,
        ...(skill.tags && skill.tags.length > 0 ? { tags: skill.tags } : {}),
        ...(skill.capabilities && skill.capabilities.length > 0
          ? { capabilities: skill.capabilities }
          : {}),
      }));
      return { skills: items, total: all.length };
    },
  };
}
