import type { Turn } from "../runtime/state";

/**
 * Deterministically extracts failed tool-call history from `turns` so this
 * critical failure trail never depends on model output.
 */
export function collectAgenticSupportHistory(turns: Turn[]): string[] {
  return turns.flatMap((turn) =>
    turn.toolResults
      .filter((result) => !result.ok)
      .map((result) => `iter=${turn.iteration} tool-failure: ${result.error ?? "unknown error"}`),
  );
}
