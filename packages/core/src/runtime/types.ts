import type { ModelProfile } from "../model/types";
import type { TraceContext } from "../observability/types";
import type { SafetyMode } from "../policy/types";
import type { ToolCall, ToolDefinition } from "../tools/types";
import type { RunState } from "./state";

export interface RuntimeLimits {
  toolTimeoutMs: number;
  maxActionCallsPerRun: number;
}

export interface CapabilityScope {
  allowActions?: string[];
  denyActions?: string[];
}

export type BeforeLoopHook = (state: RunState, iteration: number) => Promise<void> | void;
export type AfterLoopHook = (state: RunState, iteration: number) => Promise<void> | void;

export interface ApprovalRequest {
  runId: string;
  iteration: number;
  promptName: string;
  tool: ToolDefinition;
  call: ToolCall;
  reason: string;
  safetyMode?: SafetyMode;
  parentSessionId?: string;
  parentRunId?: string;
  rootSessionId?: string;
  depth?: number;
}

/**
 * Handler invoked when policy returns `require_approval`. Return `true` to
 * allow the tool call, `false` to block it. When no handler is configured,
 * `require_approval` decisions are treated as blocked.
 */
export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean> | boolean;

export interface RunOptions {
  maxIterations: number;
  /** Persist a session snapshot every N iterations. Must be a positive integer. */
  snapshotEvery: number;
  profile: ModelProfile;
  modelOverride?: string;
  sessionId?: string;
  resume?: boolean;
  goal?: string;
  /** Per-run overrides merged over the runtime's default limits. */
  limits?: Partial<RuntimeLimits>;
  /** When this run is a spawned subagent, records the parent session id. */
  parentSessionId?: string;
  parentRunId?: string;
  rootSessionId?: string;
  depth?: number;
  /** Optional UI label for this run (for example a subagent display name). */
  displayName?: string;
  spawnedByTool?: string;
  /** Parent span context, propagated so a subagent run joins the parent trace. */
  parentTrace?: TraceContext;
  capabilityScope?: CapabilityScope;
  /**
   * Controls runtime-managed subagent joining after action execution.
   * - true: auto-join all currently running subagents.
   * - false: disable runtime auto-join (model/tool-driven waits only).
   */
  autoJoinSubagents?: boolean;
}

export interface AgentInvokeRequest {
  prompt: string;
  execution: RunOptions;
}

export interface AgentRunResult {
  summary: string;
  state: RunState;
  runId: string;
  sessionId?: string;
}

/**
 * Narrow invoke/kill surface shared by the top-level {@link Agent} and its
 * subagents. The prompt persona is bound when the agent is constructed, so it
 * is not part of the request.
 */
export interface AgentHandle {
  readonly id: string;
  readonly kind: "main" | "subagent";
  readonly sessionId?: string;
  readonly promptName: string;
  invoke(request: AgentInvokeRequest): Promise<AgentRunResult>;
  kill(reason?: string): void;
}
