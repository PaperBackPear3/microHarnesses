import type { Turn } from "@micro-harnesses/core";
import { truncate } from "@micro-harnesses/core";

/**
 * Renders a bounded, deterministic text transcript of `turns` for use inside
 * subagent prompts (summarizer / goal-finder). Each turn becomes one line:
 * `iter=<n> | user: <...> | assistant: <...> tools=[a, b]`. The result is
 * capped at `maxChars`, appending a truncation marker when clipped so the
 * receiving model knows the transcript was cut short.
 */
export function buildTranscript(turns: Turn[], maxChars: number): string {
  const lines = turns.map((turn) => renderTurnLine(turn));
  const joined = lines.join("\n");
  if (joined.length <= maxChars) {
    return joined;
  }
  return `${joined.slice(0, Math.max(0, maxChars))}\n...(truncated)`;
}

function renderTurnLine(turn: Turn): string {
  const parts = [`iter=${turn.iteration}`];
  const user = turn.userMessage.trim();
  if (user.length > 0) {
    parts.push(`user: ${truncate(user, 200)}`);
  }
  const assistant = turn.assistantMessage.trim();
  if (assistant.length > 0) {
    parts.push(`assistant: ${truncate(assistant, 240)}`);
  }
  const tools =
    turn.toolCalls.length > 0
      ? ` tools=[${turn.toolCalls.map((call) => call.name).join(", ")}]`
      : "";
  return `${parts.join(" | ")}${tools}`;
}
