import type { SessionsArgs } from "../args.js";
import { loadCliConfig } from "../../config/config.js";
import { SessionService } from "../../session/sessionService.js";

export async function sessionsCommand(args: SessionsArgs): Promise<void> {
  const config = await loadCliConfig({ stateDir: args.stateDir });
  const stateDir = config.stateDir;
  const service = new SessionService(stateDir);
  const store = service.getStore();
  if (args.sub === "list") {
    const sessions = await store.listSessions();
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return;
  }
  if (!args.sessionId) {
    throw new Error("sessions show requires a session id");
  }
  const session = await service.getDetails(args.sessionId);
  process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
}
