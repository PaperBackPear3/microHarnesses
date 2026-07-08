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
  const candidate = await resolvePromptPackName(requestedPromptName, promptsDir, {
    defaultPromptName: DEFAULT_PROMPT_PACK,
    invalidMessage: async (value) =>
      `Invalid subagent promptName "${value}". promptName must be a prompt-pack id (lowercase letters, digits, hyphens)${await describeAvailablePacks(promptsDir)}. For model ids use the "model" field (e.g. model: "ollama/lfm2.5:8b"). Use "name" for display labels.`,
    unknownMessage: async (value) =>
      `Unknown subagent promptName "${value}"${await describeAvailablePacks(promptsDir)}. Use "name" for display labels such as "${value}".`,
  });
  return candidate;
}

export async function resolveMainPromptName(
  requestedPromptName: string | undefined,
  promptsDir: string,
): Promise<string> {
  return resolvePromptPackName(requestedPromptName, promptsDir, {
    defaultPromptName: DEFAULT_PROMPT_PACK,
    invalidMessage: async (value) =>
      `Invalid persona "${value}". Persona must be a prompt-pack id (lowercase letters, digits, hyphens)${await describeAvailablePacks(promptsDir)}.`,
    unknownMessage: async (value) =>
      `Unknown persona "${value}"${await describeAvailablePacks(promptsDir)}.`,
  });
}

async function resolvePromptPackName(
  requestedPromptName: string | undefined,
  promptsDir: string,
  messages: {
    defaultPromptName: string;
    invalidMessage(value: string): Promise<string>;
    unknownMessage(value: string): Promise<string>;
  },
): Promise<string> {
  const candidate = requestedPromptName?.trim();
  if (!candidate) {
    return messages.defaultPromptName;
  }
  if (!PROMPT_PACK_ID.test(candidate)) {
    throw new Error(await messages.invalidMessage(candidate));
  }
  const promptFile = path.join(promptsDir, candidate, "system.md");
  try {
    await access(promptFile);
    return candidate;
  } catch {
    throw new Error(await messages.unknownMessage(candidate));
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
