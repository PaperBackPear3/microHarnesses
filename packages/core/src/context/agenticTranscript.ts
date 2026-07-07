import type { Turn } from "../runtime/state";
import { truncate } from "../shared/text";

/**
 * Renders a bounded, deterministic text transcript of `turns` for use inside
 * subagent prompts (summarizer / goal-finder).
 */
export function buildAgenticCompressionTranscript(turns: Turn[], maxChars: number): string {
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
