import type { SkillCall, SkillResult } from "../skills/types";
import type { ToolCall, ToolResult } from "../tools/types";

/**
 * One iteration of the agent loop: the (optional) user/task message, the
 * assistant message, and the actions taken with their results. Later loop
 * iterations leave `userMessage` empty — only the first turn carries the prompt.
 */
export interface Turn {
  id: string;
  iteration: number;
  userMessage: string;
  assistantMessage: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  skillCalls?: SkillCall[];
  skillResults?: SkillResult[];
}

/** Accumulated state of a single agent run. */
export interface RunState {
  sessionId?: string;
  runId: string;
  startedAt: string;
  turns: Turn[];
}
