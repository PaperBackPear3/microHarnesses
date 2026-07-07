import type { PolicyRule } from "../policy/types";

/**
 * Interaction modes for an agentic harness:
 * - `plan` — planning-safe exploration with approval-gated commands;
 * - `accept-edits` — mutating actions require user approval;
 * - `autopilot` — actions are auto-approved and the agent continues until done.
 */
export type HarnessMode = "plan" | "accept-edits" | "autopilot";

export const MODE_SEQUENCE: HarnessMode[] = ["plan", "accept-edits", "autopilot"];

export class ModeController {
  private mode: HarnessMode;

  constructor(initialMode: HarnessMode) {
    this.mode = initialMode;
  }

  getMode(): HarnessMode {
    return this.mode;
  }

  setMode(mode: HarnessMode): void {
    this.mode = mode;
  }

  cycle(): HarnessMode {
    const index = MODE_SEQUENCE.indexOf(this.mode);
    const next = MODE_SEQUENCE[(index + 1) % MODE_SEQUENCE.length] as HarnessMode;
    this.mode = next;
    return next;
  }
}

export function parseMode(input: string | undefined): HarnessMode | undefined {
  if (!input) return undefined;
  if (input === "plan" || input === "accept-edits" || input === "autopilot") {
    return input;
  }
  if (input === "edits") {
    return "accept-edits";
  }
  if (input === "auto") {
    return "autopilot";
  }
  return undefined;
}

/** Tools that mutate the workspace and need approval in accept-edits mode. */
export const DEFAULT_MUTATING_TOOLS = [
  "fs_write",
  "fs_append",
  "fs_mkdir",
  "fs_move",
  "fs_remove",
  "shell_exec",
];

/** Read-only / planning tools allowed while in plan mode. */
export const DEFAULT_PLAN_ALLOWED_TOOLS = [
  "tool_output_read",
  "fs_list",
  "fs_read",
  "grep_search",
  "plan_agent",
  "explore_agent",
  "plan_mode_info",
  "echo",
  "time",
];

/** Tools that may run in plan mode only after explicit approval. */
export const DEFAULT_PLAN_APPROVAL_TOOLS = ["shell_exec"];

export interface ModeAwarePolicyOptions {
  /** Overrides DEFAULT_MUTATING_TOOLS. */
  mutatingTools?: string[];
  /** Overrides DEFAULT_PLAN_ALLOWED_TOOLS. */
  planAllowedTools?: string[];
  /** Overrides DEFAULT_PLAN_APPROVAL_TOOLS. */
  planApprovalTools?: string[];
}

/**
 * PolicyRule that enforces the current harness mode: autopilot auto-approves,
 * plan mode allows safe planning tools and requires approval for command tools,
 * and accept-edits requires approval for mutating tools.
 */
export function createModeAwareApprovalPolicy(
  modeController: ModeController,
  options: ModeAwarePolicyOptions = {},
): PolicyRule {
  const mutating = new Set(options.mutatingTools ?? DEFAULT_MUTATING_TOOLS);
  const planAllowed = new Set(options.planAllowedTools ?? DEFAULT_PLAN_ALLOWED_TOOLS);
  const planApproval = new Set(options.planApprovalTools ?? DEFAULT_PLAN_APPROVAL_TOOLS);

  return async (tool) => {
    const mode = modeController.getMode();
    if (mode === "autopilot") {
      return { decision: "allow", reason: "Autopilot mode auto-approves actions" };
    }
    if (mode === "plan") {
      if (planApproval.has(tool.name)) {
        return {
          decision: "require_approval",
          reason: `Tool "${tool.name}" requires approval in plan mode`,
        };
      }
      if (!planAllowed.has(tool.name)) {
        return { decision: "deny", reason: `Tool "${tool.name}" denied in plan mode` };
      }
      return { decision: "allow", reason: "Planning-safe tool allowed in plan mode" };
    }
    if (mutating.has(tool.name)) {
      return {
        decision: "require_approval",
        reason: `Tool "${tool.name}" requires approval in accept-edits mode`,
      };
    }
    return { decision: "allow", reason: "Tool allowed in accept-edits mode" };
  };
}

export function isMutatingTool(name: string): boolean {
  return DEFAULT_MUTATING_TOOLS.includes(name);
}

export function planModeAllowActions(): string[] {
  return [...DEFAULT_PLAN_ALLOWED_TOOLS, ...DEFAULT_PLAN_APPROVAL_TOOLS];
}

const AUTOPILOT_INSTRUCTIONS = [
  "Autopilot contract:",
  "- Continue autonomously until the requested goal is actually complete.",
  "- Do not stop after announcing a next step; execute the next step in the same run.",
  "- For path exploration requests, list the requested path, recurse through discovered directories, inspect relevant files, and end with a concise summary of what each explored part does.",
  "- If a directory listing tool returns structured fields like `truncated`, trust those fields instead of any visually clipped display; only say the listing is truncated when `truncated: true`.",
  "- Only stop early when blocked by a real error, and clearly state the blocker.",
].join("\n");

/** Appends the autopilot execution contract to prompts sent in autopilot mode. */
export function withModeExecutionContract(prompt: string, mode: HarnessMode): string {
  const trimmed = prompt.trim();
  if (mode !== "autopilot" || trimmed.length === 0) return prompt;
  return `${trimmed}\n\n${AUTOPILOT_INSTRUCTIONS}`;
}
