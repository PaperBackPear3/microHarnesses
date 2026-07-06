import type {
  CompressionResult,
  CompressorFn,
  SubagentResult,
  SubagentRunOptions,
  Turn,
} from "@micro-harnesses/core";
import { defaultCompressor, truncate } from "@micro-harnesses/core";
import { collectSupportHistory } from "./collectSupportHistory";
import { parseGoalOutput, parseSummaryOutput } from "./parseAgentOutput";
import { buildTranscript } from "./transcript";

export type SpawnFn = (options: SubagentRunOptions) => Promise<SubagentResult>;

export interface AgenticCompressorOptions {
  /** Delegates to `PluginApi.agents.spawn` (or an equivalent `SubagentRunner.run`). */
  spawn: SpawnFn;
  /** Prompt persona for the summarizer subagent. Default: "context-summarizer". */
  summarizerPromptName?: string;
  /** Prompt persona for the goal-finder subagent. Default: "goal-finder". */
  goalFinderPromptName?: string;
  /** Iteration cap for each subagent run. Default: 2. */
  maxIterations?: number;
  /** Max characters of transcript included in each subagent prompt. Default: 6000. */
  maxTranscriptChars?: number;
  /** Max highlights kept in the final result. Default: 8. */
  maxHighlights?: number;
  /** Used when subagent spawning fails for any reason. Default: `defaultCompressor`. */
  fallback?: CompressorFn;
}

/**
 * Builds a `CompressorFn` that compresses overflowed turns by spawning two
 * subagents in parallel — a summarizer and a goal-finder — instead of scoring
 * turns heuristically. Both subagents run with `allowedTools: []` (pure text
 * generation, no side effects) and inherit whatever model/provider/effort the
 * host composition currently has selected, since `spawn` is backed by the
 * same `SubagentRuntimeFactory` the rest of the app uses.
 *
 * Never throws: any spawn/model failure falls back to a deterministic
 * compressor (`defaultCompressor` by default) so compression can never break
 * a run.
 */
export function createAgenticCompressor(options: AgenticCompressorOptions): CompressorFn {
  const summarizerPromptName = options.summarizerPromptName ?? "context-summarizer";
  const goalFinderPromptName = options.goalFinderPromptName ?? "goal-finder";
  const maxIterations = options.maxIterations ?? 2;
  const maxTranscriptChars = options.maxTranscriptChars ?? 6000;
  const maxHighlights = options.maxHighlights ?? 8;
  const fallback = options.fallback ?? defaultCompressor;

  return async (turns, context) => {
    if (turns.length === 0) {
      return {
        summary: context.previousSummary?.summary ?? "",
        highlights: context.previousSummary?.highlights ?? [],
        supportHistory: [],
      };
    }

    const goal = context.goal?.trim() || "No explicit goal set";
    const transcript = buildTranscript(turns, maxTranscriptChars);
    const previousSummaryText = context.previousSummary?.summary?.trim();

    try {
      const [summaryResult, goalResult] = await Promise.all([
        options.spawn({
          prompt: buildSummarizerPrompt(goal, transcript, previousSummaryText, turns.length),
          promptName: summarizerPromptName,
          allowedTools: [],
          maxIterations,
          goal,
        }),
        options.spawn({
          prompt: buildGoalFinderPrompt(goal, transcript, turns.length),
          promptName: goalFinderPromptName,
          allowedTools: [],
          maxIterations,
          goal,
        }),
      ]);

      return combineResults(goal, turns.length, summaryResult, goalResult, maxHighlights, turns);
    } catch {
      // Compression must never break a run — fall back to a deterministic
      // strategy when subagent spawning itself fails (e.g. no model/provider
      // configured, or a transient provider error).
      return fallback(turns, context);
    }
  };
}

function combineResults(
  goal: string,
  turnCount: number,
  summaryResult: SubagentResult,
  goalResult: SubagentResult,
  maxHighlights: number,
  turns: Turn[],
): CompressionResult {
  const parsedSummary = parseSummaryOutput(summaryResult.summary);
  const parsedGoal = parseGoalOutput(goalResult.summary);

  const highlights = [
    ...parsedSummary.highlights,
    ...parsedGoal.subgoals.map((subgoal) => `goal: ${subgoal}`),
  ].slice(0, maxHighlights);

  const refinedGoal =
    parsedGoal.goal.length > 0 && parsedGoal.goal !== goal ? parsedGoal.goal : undefined;

  const summaryParts = [
    parsedSummary.summary || `Compressed ${turnCount} older turns.`,
    refinedGoal ? `Refined goal: ${refinedGoal}` : "",
  ].filter((part) => part.length > 0);

  return {
    summary: truncate(summaryParts.join(" "), 800),
    highlights,
    supportHistory: collectSupportHistory(turns),
    ...(refinedGoal ? { refinedGoal } : {}),
  };
}

function buildSummarizerPrompt(
  goal: string,
  transcript: string,
  previousSummary: string | undefined,
  turnCount: number,
): string {
  return [
    "You are compressing older conversation history for an autonomous coding agent so it can continue with less context.",
    "",
    `Goal: ${goal}`,
    previousSummary ? `Prior summary: ${previousSummary}` : "",
    "",
    `Conversation excerpt to compress (${turnCount} turns):`,
    transcript,
    "",
    "Respond in exactly this format and nothing else:",
    "SUMMARY: <one paragraph, at most 400 characters, capturing what happened and why it matters>",
    "HIGHLIGHTS:",
    "- <most important fact or decision>",
    "- <...>",
    "(3-6 bullet items)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildGoalFinderPrompt(goal: string, transcript: string, turnCount: number): string {
  return [
    "You are inferring the user's true underlying goal from a conversation excerpt, since goals can shift or become clearer as work progresses.",
    "",
    `Originally stated goal: ${goal}`,
    "",
    `Conversation excerpt (${turnCount} turns):`,
    transcript,
    "",
    "Respond in exactly this format and nothing else:",
    "GOAL: <single sentence restating the current, most accurate goal>",
    "SUBGOALS:",
    "- <supporting sub-goal or open question>",
    "- <...>",
    "(0-5 bullet items; omit the SUBGOALS section entirely if there are none)",
  ].join("\n");
}
