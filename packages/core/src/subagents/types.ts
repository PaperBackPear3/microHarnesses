import type { RunState } from "../runtime/state";
import type { AgentHandle, AgentInvokeRequest, RunOptions } from "../runtime/types";

export interface SubagentRunOptions {
  prompt: string;
  /** Prompt-pack persona the child agent runs; defaults to the parent's persona. */
  promptName?: string;
  maxIterations?: number;
  /** Tools the child may use; defaults to all parent tools except spawn tools. */
  allowedTools?: string[];
  /** Abort signal propagated to the child agent (kills it on abort). */
  signal?: AbortSignal;
  /** Optional goal string for the child session. */
  goal?: string;
}

export interface SubagentResult {
  /** Final assistant message of the child run — the only context returned to the parent. */
  summary: string;
  state: RunState;
}

export interface SubagentRunner {
  run(options: SubagentRunOptions): Promise<SubagentResult>;
}

/**
 * Composition-root callback that builds a child agent for a subagent run.
 * The parent agent is passed in so the factory can pull the parent session
 * id (`parent.sessionId`) into the child manifest. The child agent binds its
 * prompt persona at construction, so the built agent carries no separate name.
 */
export interface SubagentRuntimeFactory {
  build(
    request: SubagentRunOptions,
    parent: AgentHandle,
  ): SubagentBuiltRuntime | Promise<SubagentBuiltRuntime>;
}

export interface SubagentBuiltRuntime {
  agent: AgentHandle;
  runOptions: RunOptions;
  prompt: string;
}

export interface SubagentBuiltAgentInvoke {
  agent: AgentHandle;
  request: AgentInvokeRequest;
}
