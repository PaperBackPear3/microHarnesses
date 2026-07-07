import { access, readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROMPT_PACK = "coder";
const PROMPT_PACK_ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Resolves the prompt-pack persona for a spawned subagent. `promptName` must be
 * a safe prompt-pack identifier that matches an installed pack under
 * `promptsDir`. Free-form display labels belong in `name`, not here.
 */
export async function resolveSubagentPromptName(
  requestedPromptName: string | undefined,
  promptsDir: string,
): Promise<string> {
  const candidate = requestedPromptName?.trim();
  if (!candidate) {
    return DEFAULT_PROMPT_PACK;
  }
  if (!PROMPT_PACK_ID.test(candidate)) {
    throw new Error(
      `Invalid subagent promptName "${candidate}". promptName must be a prompt-pack id (lowercase letters, digits, hyphens)${await describeAvailablePacks(promptsDir)}. Use "name" for display labels.`,
    );
  }
  const promptFile = path.join(promptsDir, candidate, "system.md");
  try {
    await access(promptFile);
    return candidate;
  } catch {
    throw new Error(
      `Unknown subagent promptName "${candidate}"${await describeAvailablePacks(promptsDir)}. Use "name" for display labels such as "${candidate}".`,
    );
  }
}

async function describeAvailablePacks(promptsDir: string): Promise<string> {
  const packs = await listPromptPacks(promptsDir);
  if (packs.length === 0) {
    return "";
  }
  return `. Valid promptName values are: ${packs.join(", ")}`;
}

async function listPromptPacks(promptsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(promptsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
