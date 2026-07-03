import type { HarnessState } from "../context/types";
import type { ModelProfile } from "../model/types";
import type { SafetyMode } from "../policy/types";
import type { ToolCall, ToolDefinition } from "../tools/types";

export interface RuntimeLimits {
  toolTimeoutMs: number;
  maxToolCallsPerRun: number;
}

export type BeforeLoopHook = (state: HarnessState, iteration: number) => Promise<void> | void;
export type AfterLoopHook = (state: HarnessState, iteration: number) => Promise<void> | void;

export interface ApprovalRequest {
  runId: string;
  iteration: number;
  agentName: string;
  tool: ToolDefinition;
  call: ToolCall;
  reason: string;
  safetyMode?: SafetyMode;
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
}
