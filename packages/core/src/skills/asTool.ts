import type { ToolDefinition, ToolResolver } from "../tools/types";
import type { SkillRegistry } from "./registry";
import type { SkillDefinition } from "./types";

/**
 * Adapts a skill to a `ToolDefinition` so it can run through the same governed
 * execution engine as tools (policy, approval, scope, timeout, cancellation,
 * events, and the shared call budget). Risk defaults to `"low"`.
 */
export function skillToTool(skill: SkillDefinition): ToolDefinition {
  return {
    name: skill.name,
    description: skill.description,
    risk: skill.risk ?? "low",
    capabilities: skill.capabilities,
    tags: skill.tags,
    inputSchema: skill.inputSchema,
    execute: (input, context) => skill.execute(input, { signal: context?.signal }),
  };
}

/** Presents a `SkillRegistry` as a `ToolResolver` of governed skill actions. */
export function skillsAsToolResolver(skills: SkillRegistry): ToolResolver {
  return {
    get: (name) => skillToTool(skills.get(name)),
    list: () => skills.list().map(skillToTool),
  };
}
