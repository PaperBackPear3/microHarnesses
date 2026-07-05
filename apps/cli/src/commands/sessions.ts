import { SessionStore } from "@micro-harnesses/core";
import { parseSessionsArgs } from "../args";
import { runCommandWithPrompt } from "./run";

export async function sessionsCommand(args: string[], defaultPromptsDir: string): Promise<void> {
  const parsed = parseSessionsArgs(args);
  const sessionStore = new SessionStore(parsed.stateDir);

  if (parsed.sub === "list") {
    const sessions = await sessionStore.listSessions();
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return;
  }

  if (parsed.sub === "show") {
    if (!parsed.sessionId) {
      throw new Error("Usage: sessions show <session-id>");
    }
    const session = await sessionStore.getSession(parsed.sessionId);
    process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
    return;
  }

  if (parsed.sub === "resume") {
    if (!parsed.sessionId) {
      throw new Error("Usage: sessions resume <session-id> <prompt>");
    }
    const prompt = parsed.resumePrompt ?? "continue from last state";
    const forwarded = [...parsed.extraArgs, "--session-id", parsed.sessionId, "--resume"];
    await runCommandWithPrompt(forwarded, prompt, defaultPromptsDir);
    return;
  }

  throw new Error(`Unknown sessions subcommand: ${parsed.sub}`);
}
