export interface ParsedSummary {
  summary: string;
  highlights: string[];
}

export interface ParsedGoal {
  goal: string;
  subgoals: string[];
}

const SUMMARY_LABEL = /^summary:\s*/i;
const HIGHLIGHTS_LABEL = /^highlights:\s*$/i;
const GOAL_LABEL = /^goal:\s*/i;
const SUBGOALS_LABEL = /^subgoals:\s*$/i;
const BULLET = /^[-*]\s+(.*)$/;

/**
 * Parses a summarizer subagent's reply. Expects a `SUMMARY:` line followed by
 * an optional `HIGHLIGHTS:` section of bullet points. Falls back to treating
 * the first non-empty line as the summary when the model doesn't follow the
 * requested format exactly, so malformed output never throws.
 */
export function parseSummaryOutput(raw: string): ParsedSummary {
  let summary = "";
  const highlights: string[] = [];
  let inHighlights = false;

  for (const line of raw.split(/\r?\n/).map((entry) => entry.trim())) {
    if (line.length === 0) continue;
    if (SUMMARY_LABEL.test(line)) {
      summary = line.replace(SUMMARY_LABEL, "").trim();
      inHighlights = false;
      continue;
    }
    if (HIGHLIGHTS_LABEL.test(line)) {
      inHighlights = true;
      continue;
    }
    const bullet = line.match(BULLET);
    if (inHighlights && bullet) {
      highlights.push(bullet[1].trim());
      continue;
    }
    if (summary.length === 0 && !inHighlights) {
      summary = line;
    }
  }

  return { summary: summary || raw.trim().slice(0, 400), highlights };
}

/**
 * Parses a goal-finder subagent's reply. Expects a `GOAL:` line followed by
 * an optional `SUBGOALS:` section of bullet points. Same permissive fallback
 * behavior as {@link parseSummaryOutput}.
 */
export function parseGoalOutput(raw: string): ParsedGoal {
  let goal = "";
  const subgoals: string[] = [];
  let inSubgoals = false;

  for (const line of raw.split(/\r?\n/).map((entry) => entry.trim())) {
    if (line.length === 0) continue;
    if (GOAL_LABEL.test(line)) {
      goal = line.replace(GOAL_LABEL, "").trim();
      inSubgoals = false;
      continue;
    }
    if (SUBGOALS_LABEL.test(line)) {
      inSubgoals = true;
      continue;
    }
    const bullet = line.match(BULLET);
    if (inSubgoals && bullet) {
      subgoals.push(bullet[1].trim());
      continue;
    }
    if (goal.length === 0 && !inSubgoals) {
      goal = line;
    }
  }

  return { goal: goal || raw.trim().slice(0, 200), subgoals };
}
