import type { TraceContext } from "../observability/types";
import type { RunState } from "../runtime/state";
import type { AgentHandle, AgentInvokeRequest, RunOptions } from "../runtime/types";

export interface SubagentRunOptions {
  /** Human-friendly display name for UI/status surfaces. */
  name?: string;
  prompt: string;
  /** Prompt-pack persona the child agent runs; default is runtime-specific (CLI defaults to `coder`). */
  promptName?: string;
  maxIterations?: number;
  /** Tools the child may use; defaults to all parent tools except spawn tools. */
  allowedTools?: string[];
  /** Abort signal propagated to the child agent (kills it on abort). */
  signal?: AbortSignal;
  /** Optional goal string for the child session. */
  goal?: string;
  /** Parent span context, so the child run joins the parent's trace. */
  parentTrace?: TraceContext;
}

export interface SubagentResult {
  /** Final assistant message of the child run — the only context returned to the parent. */
  summary: string;
  state: RunState;
}

export type SubagentStatus = "running" | "completed" | "failed";

export interface SubagentSnapshot {
  id: string;
  launchIndex: number;
  name?: string;
  prompt: string;
  promptName?: string;
  goal?: string;
  sessionId?: string;
  status: SubagentStatus;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  error?: string;
}

export interface SubagentSpawnResult {
  id: string;
  launchIndex: number;
  sessionId?: string;
  status: "running";
}

export interface SubagentWaitOptions {
  /**
   * Subagent handles to wait for. When omitted, waits over all currently
   * running subagents tracked by the supervisor.
   */
  ids?: string[];
  /**
   * "next" resolves when the next selected subagent finishes. "all" resolves
   * when every selected running subagent has finished.
   */
  mode?: "next" | "all";
  /** Abort signal propagated from the waiting tool/run. */
  signal?: AbortSignal;
}

export interface SubagentWaitResult {
  completed: SubagentSnapshot[];
  running: SubagentSnapshot[];
}

export interface SubagentService {
  run(options: SubagentRunOptions): Promise<SubagentResult>;
  spawn(options: SubagentRunOptions): Promise<SubagentSpawnResult>;
  wait(options?: SubagentWaitOptions): Promise<SubagentWaitResult>;
  list(): SubagentSnapshot[];
}
export type SubagentRunner = SubagentService;
export type SubagentSupervisor = SubagentService;

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
