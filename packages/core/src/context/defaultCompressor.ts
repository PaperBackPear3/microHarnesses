import type { Turn } from "../runtime/state";
import { truncate } from "../shared/text";
import type { CompressionResult } from "./types";

/**
 * Built-in compressor: scores turns by recency, impact (tool calls, failures,
 * spawns) and goal keyword match, keeping the top highlights plus a support
 * history of failed tool calls.
 */
export async function defaultCompressor(
  turns: Turn[],
  context: { goal?: string; previousSummary?: CompressionResult },
): Promise<CompressionResult> {
  const goal = context.goal?.trim() || "No explicit goal set";
  const scored = turns
    .map((turn, index) => ({
      turn,
      score: computeTurnScore(turn, index, turns.length, goal),
    }))
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(6, scored.length)).map((entry) => entry.turn);
  const highlights = top.map((turn) => {
    const user = truncate(turn.userMessage.trim(), 80);
    const assistant = truncate(turn.assistantMessage.trim(), 100);
    return `iter=${turn.iteration} tools=${turn.toolCalls.length} user="${user}" assistant="${assistant}"`;
  });

  const supportHistory = turns.flatMap((turn) =>
    turn.toolResults
      .filter((result) => !result.ok)
      .map((result) => `iter=${turn.iteration} tool-failure: ${result.error ?? "unknown error"}`),
  );

  const previousSummary = context.previousSummary?.summary?.trim();
  const summaryParts = [
    `Goal: ${goal}.`,
    previousSummary ? `Prior context: ${truncate(previousSummary, 260)}` : "",
    `Compressed ${turns.length} older turns and retained ${highlights.length} key highlights.`,
  ].filter((part) => part.length > 0);

  return {
    summary: summaryParts.join(" "),
    highlights,
    supportHistory,
  };
}

function computeTurnScore(turn: Turn, index: number, total: number, goal: string): number {
  const recency = total > 1 ? index / (total - 1) : 1;
  const impact = turn.toolCalls.length * 2 + turn.toolResults.filter((r) => !r.ok).length * 3;
  const goalMatch =
    includesAny(turn.assistantMessage, goal) || includesAny(turn.userMessage, goal) ? 2 : 0;
  return recency * 5 + impact + goalMatch;
}

function includesAny(text: string, goal: string): boolean {
  const words = goal
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 10);
  if (words.length === 0) {
    return false;
  }
  const lowerText = text.toLowerCase();
  return words.some((word) => lowerText.includes(word));
}
