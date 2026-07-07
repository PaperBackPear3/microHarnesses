import {
  type HarnessMode,
  type ModelRoutingPreference,
  parseEffort,
  parseMode,
  parseModelRoutingPreference,
} from "@micro-harnesses/core";

export type UiScreen = "chat" | "sessions" | "session-details" | "context" | "telemetry" | "help";

export type SlashCommand =
  | { type: "new-session" }
  | { type: "switch-session"; sessionId: string }
  | { type: "show-sessions" }
  | { type: "show-session-details"; sessionId: string }
  | { type: "set-mode"; mode: HarnessMode }
  | { type: "set-effort"; effort: "low" | "medium" | "high" }
  | { type: "list-models" }
  | { type: "set-model"; model: string | undefined }
  | { type: "set-provider"; provider: string }
  | { type: "set-routing-preference"; preference: ModelRoutingPreference | undefined }
  | { type: "compact" }
  | { type: "wait-subagents" }
  | { type: "show-context" }
  | { type: "show-telemetry" }
  | { type: "show-help" }
  | { type: "show-chat" }
  | { type: "clear" }
  | { type: "exit" };

export function parseSlashCommand(input: string): SlashCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const [raw, ...args] = trimmed.slice(1).split(/\s+/);
  const command = raw.toLowerCase();

  if (command === "new") return { type: "new-session" };
  if (command === "sessions") return { type: "show-sessions" };
  if (command === "resume" && args[0]) return { type: "switch-session", sessionId: args[0] };
  if (command === "session" && args[0]) return { type: "show-session-details", sessionId: args[0] };
  if (command === "mode" && args[0]) {
    const mode = parseMode(args[0]);
    if (mode) return { type: "set-mode", mode };
  }
  if (command === "plan") return { type: "set-mode", mode: "plan" };
  if (command === "edits") return { type: "set-mode", mode: "accept-edits" };
  if (command === "autopilot") return { type: "set-mode", mode: "autopilot" };
  if (command === "effort" && args[0]) {
    const effort = parseEffort(args[0]);
    if (effort) return { type: "set-effort", effort };
  }
  if (command === "model") {
    if (!args[0]) return { type: "list-models" };
    if (args[0].toLowerCase() === "auto") return { type: "set-model", model: undefined };
    return { type: "set-model", model: args[0] };
  }
  if (command === "provider" && args[0]) return { type: "set-provider", provider: args[0] };
  if (command === "route") {
    if (!args[0] || args[0].toLowerCase() === "off") {
      return { type: "set-routing-preference", preference: undefined };
    }
    const preference = normalizeRoutingPreference(args[0]);
    if (preference) return { type: "set-routing-preference", preference };
  }
  if (command === "compact") return { type: "compact" };
  if (command === "wait") return { type: "wait-subagents" };
  if (command === "context") return { type: "show-context" };
  if (command === "telemetry") return { type: "show-telemetry" };
  if (command === "help" || command === "commands") return { type: "show-help" };
  if (command === "chat") return { type: "show-chat" };
  if (command === "clear") return { type: "clear" };
  if (command === "exit" || command === "quit") return { type: "exit" };
  return undefined;
}

function normalizeRoutingPreference(value: string): ModelRoutingPreference | undefined {
  return parseModelRoutingPreference(value);
}
