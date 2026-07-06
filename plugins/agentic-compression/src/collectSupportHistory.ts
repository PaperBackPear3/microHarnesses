import type { Turn } from "@micro-harnesses/core";

/**
 * Deterministically extracts failed tool-call history from `turns` — kept
 * non-LLM (mirrors `defaultCompressor`'s support history) so this critical
 * failure trail never depends on a model following instructions correctly.
 */
export function collectSupportHistory(turns: Turn[]): string[] {
  return turns.flatMap((turn) =>
    turn.toolResults
      .filter((result) => !result.ok)
      .map((result) => `iter=${turn.iteration} tool-failure: ${result.error ?? "unknown error"}`),
  );
}
