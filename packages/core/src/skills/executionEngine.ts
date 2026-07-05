import { UnknownSkillError } from "../shared/errors";
import type { SkillRegistry } from "./registry";
import type { SkillCall, SkillDefinition, SkillResult } from "./types";

export interface SkillExecutionEngineDeps {
  skills: SkillRegistry;
}

export class SkillExecutionEngine {
  private readonly skills: SkillRegistry;

  constructor(deps: SkillExecutionEngineDeps) {
    this.skills = deps.skills;
  }

  async execute(call: SkillCall, signal?: AbortSignal): Promise<SkillResult> {
    let skill: SkillDefinition;
    try {
      skill = this.skills.get(call.name);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `Unknown skill: ${call.name}`;
      return { ok: false, output: {}, error: message };
    }

    try {
      const output = await skill.execute(call.input, { signal });
      return { ok: true, output };
    } catch (error: unknown) {
      const message =
        error instanceof UnknownSkillError || error instanceof Error
          ? error.message
          : "unknown skill error";
      return { ok: false, output: {}, error: message };
    }
  }
}
