import type { HarnessState } from "../context/types";

export interface SubagentRunOptions {
  prompt: string;
  /** Prompt-pack agent to run; defaults to the parent's agent. */
  agentName?: string;
  maxIterations?: number;
  /** Tools the child may use; defaults to all parent tools except spawn tools. */
  allowedTools?: string[];
  /** Abort signal propagated to the child runtime (kills it on abort). */
  signal?: AbortSignal;
}

export interface SubagentResult {
  /** Final assistant message of the child run — the only context returned to the parent. */
  summary: string;
  state: HarnessState;
}

export interface SubagentRunner {
  run(options: SubagentRunOptions): Promise<SubagentResult>;
}
