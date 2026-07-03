import type { HarnessState } from "../context/types";
import type { ModelProfile, SpawnRequest } from "../model/types";

export interface AgentSpawner {
  spawn(request: SpawnRequest): Promise<string>;
}

export interface RuntimeLimits {
  toolTimeoutMs: number;
  maxToolCallsPerRun: number;
}

export type BeforeLoopHook = (state: HarnessState, iteration: number) => Promise<void> | void;
export type AfterLoopHook = (state: HarnessState, iteration: number) => Promise<void> | void;

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
}
