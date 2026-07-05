import type { Turn } from "../runtime/state";

export interface CompressionResult {
  summary: string;
  highlights: string[];
  supportHistory: string[];
}

/**
 * Context-window utilization stats for observability: how full / empty / total
 * the working context is, in both turns and estimated tokens.
 */
export interface ContextWindowStats {
  totalTurns: number;
  workingTurns: number;
  overflowTurns: number;
  /** True when older turns were compressed into a summary this build. */
  compressed: boolean;
  usedTokens: number;
  maxTokens: number;
  /** used / max, clamped to [0, 1]; 0 when maxTokens is 0. */
  utilization: number;
}

/**
 * Result of building the working context window: the recent turns to send
 * verbatim, plus an optional compressed summary of older, overflowed turns
 * that must be reinjected so long runs don't lose prior context.
 */
export interface WorkingContext {
  recentTurns: Turn[];
  summary?: CompressionResult;
  /** Utilization stats for observability; present when a token counter is set. */
  stats?: ContextWindowStats;
}

export type CompressorFn = (
  turns: Turn[],
  context: { goal?: string },
) => Promise<CompressionResult> | CompressionResult;
