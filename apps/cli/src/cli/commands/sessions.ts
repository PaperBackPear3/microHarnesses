import { SessionStore } from "@micro-harnesses/core";
import type { SessionsArgs } from "../args";

export async function sessionsCommand(args: SessionsArgs): Promise<void> {
  const stateDir = args.stateDir ?? `${process.cwd()}/.micro-harness`;
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
