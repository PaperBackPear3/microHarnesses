import { SessionStore } from "@micro-harnesses/core";
import type { SessionsArgs } from "../args.js";
import { loadCliConfig } from "../../config/config.js";

export async function sessionsCommand(args: SessionsArgs): Promise<void> {
  const config = await loadCliConfig({ stateDir: args.stateDir });
  const stateDir = config.stateDir;
  const store = new SessionStore(stateDir);
  if (args.sub === "list") {
    const sessions = await store.listSessions();
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return;
  }
  if (!args.sessionId) {
    throw new Error("sessions show requires a session id");
  }
  const session = await store.getSession(args.sessionId);
  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}
