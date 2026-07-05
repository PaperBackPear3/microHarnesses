import type { SkillCall, SkillResult } from "../skills/types";
import type { ToolCall, ToolResult } from "../tools/types";

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

export interface HarnessState {
  sessionId?: string;
  runId: string;
  startedAt: string;
  turns: Turn[];
}

export interface CompressionResult {
  summary: string;
  highlights: string[];
  supportHistory: string[];
}

export type CompressorFn = (
  turns: Turn[],
  context: { goal?: string },
) => Promise<CompressionResult> | CompressionResult;
