import type { CliMode } from "../modes/modes";

const AUTOPILOT_INSTRUCTIONS = [
  "Autopilot contract:",
  "- Continue autonomously until the requested goal is actually complete.",
  "- Do not stop after announcing a next step; execute the next step in the same run.",
  "- For path exploration requests, list the requested path, recurse through discovered directories, inspect relevant files, and end with a concise summary of what each explored part does.",
  "- Only stop early when blocked by a real error, and clearly state the blocker.",
].join("\n");

export function withModeExecutionContract(prompt: string, mode: CliMode): string {
  const trimmed = prompt.trim();
  if (mode !== "autopilot" || trimmed.length === 0) return prompt;
  return `${trimmed}\n\n${AUTOPILOT_INSTRUCTIONS}`;
}
