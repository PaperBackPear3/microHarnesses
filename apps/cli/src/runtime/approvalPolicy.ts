import type { PolicyRule } from "@micro-harnesses/core";
import type { ModeController } from "../modes/modes";

const MUTATING_TOOLS = new Set([
  "fs_write",
  "fs_append",
  "fs_mkdir",
  "fs_move",
  "fs_remove",
  "shell_exec",
]);
const PLAN_ALLOWED_TOOLS = new Set([
  "fs_list",
  "fs_read",
  "grep_search",
  "plan_agent",
  "explore_agent",
  "plan_mode_info",
  "echo",
  "time",
]);

export function createModeAwareApprovalPolicy(modeController: ModeController): PolicyRule {
  return async (tool) => {
    const mode = modeController.getMode();
    if (mode === "autopilot") {
      return { decision: "allow", reason: "Autopilot mode auto-approves actions" };
    }
    if (mode === "plan") {
      if (!PLAN_ALLOWED_TOOLS.has(tool.name)) {
        return { decision: "deny", reason: `Tool "${tool.name}" denied in plan mode` };
      }
      return { decision: "allow", reason: "Read-only planning tool allowed in plan mode" };
    }
    if (MUTATING_TOOLS.has(tool.name)) {
      return {
        decision: "require_approval",
        reason: `Tool "${tool.name}" requires approval in accept-edits mode`,
      };
    }
    return { decision: "allow", reason: "Tool allowed in accept-edits mode" };
  };
}

export function isMutatingTool(name: string): boolean {
  return MUTATING_TOOLS.has(name);
}

export function planModeAllowActions(): string[] {
  return [...PLAN_ALLOWED_TOOLS];
}
