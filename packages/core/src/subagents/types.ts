import type { HarnessState } from "../context/types";
import type { HarnessRuntime } from "../runtime/runtime";
import type { RunOptions } from "../runtime/types";

export interface SubagentRunOptions {
  prompt: string;
  /** Prompt-pack agent to run; defaults to the parent's agent. */
  agentName?: string;
  maxIterations?: number;
  /** Tools the child may use; defaults to all parent tools except spawn tools. */
  allowedTools?: string[];
  /** Abort signal propagated to the child runtime (kills it on abort). */
  signal?: AbortSignal;
  /** Optional goal string for the child session. */
  goal?: string;
}

export interface SubagentResult {
  /** Final assistant message of the child run — the only context returned to the parent. */
  summary: string;
  state: HarnessState;
}

export interface SubagentRunner {
  run(options: SubagentRunOptions): Promise<SubagentResult>;
}

/**
 * Composition-root callback that builds a child runtime for a subagent run.
 * The parent runtime is passed in so the factory can pull the parent session
 * id (`parentRuntime.sessionId`) into the child manifest.
 */
export interface SubagentRuntimeFactory {
  build(
    request: SubagentRunOptions,
    parentRuntime: HarnessRuntime,
  ): SubagentBuiltRuntime | Promise<SubagentBuiltRuntime>;
}

export interface SubagentBuiltRuntime {
  runtime: HarnessRuntime;
  runOptions: RunOptions;
  agentName: string;
  prompt: string;
}
