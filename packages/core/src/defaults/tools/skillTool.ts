import { readRequiredString } from "../../shared/inputParsing";
import type { SkillRegistry } from "../../skills/registry";
import type { ToolDefinition } from "../../tools/types";

export function createSkillTool(skills: SkillRegistry): ToolDefinition {
  return {
    name: "skill",
    description:
      "Executes a registered skill by name. Use list_skills/find_skill first to discover options.",
    risk: "low",
    tags: ["skills", "execution"],
    capabilities: ["skills.execute"],
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact skill name to execute." },
        input: {
          type: "object",
          description: "Optional JSON input passed through to the selected skill.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const name = readRequiredString(input, "name", "skill");
      const rawSkillInput = input.input;
      if (
        rawSkillInput !== undefined &&
        (typeof rawSkillInput !== "object" || rawSkillInput === null || Array.isArray(rawSkillInput))
      ) {
        throw new Error('skill: "input" must be an object when provided');
      }
      const skillInput = (rawSkillInput ?? {}) as Record<string, unknown>;
      const selected = skills.get(name);
      return selected.execute(skillInput, { signal: context?.signal });
    },
  };
}
