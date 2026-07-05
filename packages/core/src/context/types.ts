import type { Turn } from "../runtime/state";

export interface CompressionResult {
  summary: string;
  highlights: string[];
  supportHistory: string[];
}

/**
 * Result of building the working context window: the recent turns to send
 * verbatim, plus an optional compressed summary of older, overflowed turns
 * that must be reinjected so long runs don't lose prior context.
 */
export interface WorkingContext {
  recentTurns: Turn[];
  summary?: CompressionResult;
}

export type CompressorFn = (
  turns: Turn[],
  context: { goal?: string },
) => Promise<CompressionResult> | CompressionResult;
