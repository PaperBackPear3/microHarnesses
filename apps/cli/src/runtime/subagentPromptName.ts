import { access } from "node:fs/promises";
import path from "node:path";

export async function resolveSubagentPromptName(
  requestedPromptName: string | undefined,
  promptsDir: string,
): Promise<string> {
  const candidate = requestedPromptName?.trim();
  if (!candidate) {
    return "coder";
  }
  const promptFile = path.join(promptsDir, candidate, "system.md");
  try {
    await access(promptFile);
    return candidate;
  } catch {
    throw new Error(
      `Unknown subagent promptName "${candidate}". promptName must match an installed prompt pack under ${promptsDir}; use "name" for display labels.`,
    );
  }
}
