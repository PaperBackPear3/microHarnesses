import type { CliMode } from "../modes/modes";
import type { StatusState } from "../telemetry/status";

export interface LabeledColor {
  label: string;
  color: string;
}

export interface Shortcut {
  keys: string;
  description: string;
}

const MODE_PROMPT_STYLES: Record<CliMode, LabeledColor> = {
  plan: { label: "PLAN", color: "yellow" },
  "accept-edits": { label: "EDITS", color: "green" },
  autopilot: { label: "AUTO", color: "magenta" },
};

const HELP_COMMAND_LINES_BASE = [
  "/plan | /edits | /autopilot",
  "/mode <plan|accept-edits|autopilot>",
  "/effort <low|medium|high>",
  "/provider <openai|anthropic|ollama>",
  "/new",
  "/sessions",
  "/session <id>",
  "/resume <id>",
  "/context",
  "/compact",
  "/telemetry",
  "/chat",
  "/clear",
  "/exit",
  "/help | /commands",
] as const;

const KEYBOARD_SHORTCUTS: readonly Shortcut[] = [
  { keys: "Enter", description: "send prompt" },
  { keys: "Shift+Tab", description: "cycle mode (plan → edits → autopilot)" },
  { keys: "Ctrl+T", description: "toggle collapse for all reasoning" },
  { keys: "↑ / ↓", description: "scroll transcript (when input is empty)" },
  { keys: "PgUp / PgDn", description: "page transcript scroll (when input is empty)" },
  { keys: "Esc / Ctrl+C", description: "interrupt current run" },
  { keys: "Ctrl+D", description: "exit chat" },
  { keys: "y / n / a", description: "approval: approve / reject / always" },
];

export function modePromptStyle(mode: CliMode): LabeledColor {
  return MODE_PROMPT_STYLES[mode];
}

export function modelBadgeLabel(model: string | undefined): string {
  return `model ${model ?? "default"}`;
}

export function contextBadgeStyle(status: StatusState): LabeledColor {
  const utilization = deriveUtilization(status);
  if (utilization === undefined) {
    return { label: "ctx n/a", color: "gray" };
  }
  const clamped = Math.max(0, Math.min(utilization, 1));
  const percent = Math.round(clamped * 100);
  const color = clamped >= 0.85 ? "red" : clamped >= 0.6 ? "yellow" : "green";
  const used = formatCount(status.contextUsedTokens);
  const max = formatCount(status.contextMaxTokens);
  const label = used && max ? `ctx ${percent}% (${used}/${max})` : `ctx ${percent}%`;
  return { label, color };
}

export function compactShortcutHintLine(): string {
  return "Shift+Tab mode · Ctrl+T thinking · ↑/↓ scroll · PgUp/PgDn page · Esc/Ctrl+C stop · /help commands+shortcuts";
}

export function helpCommandLines(modelChoices: string[]): string[] {
  return [
    HELP_COMMAND_LINES_BASE[0],
    HELP_COMMAND_LINES_BASE[1],
    HELP_COMMAND_LINES_BASE[2],
    `/model <id> (choices: ${modelChoices.join(", ") || "provider defaults"})`,
    ...HELP_COMMAND_LINES_BASE.slice(3),
  ];
}

export function helpShortcutLines(): string[] {
  return KEYBOARD_SHORTCUTS.map((shortcut) => `${shortcut.keys} — ${shortcut.description}`);
}

function deriveUtilization(status: StatusState): number | undefined {
  if (typeof status.contextUtilization === "number") {
    return status.contextUtilization;
  }
  if (
    typeof status.contextUsedTokens === "number" &&
    typeof status.contextMaxTokens === "number" &&
    status.contextMaxTokens > 0
  ) {
    return status.contextUsedTokens / status.contextMaxTokens;
  }
  return undefined;
}

function formatCount(value: number | undefined): string | undefined {
  if (typeof value !== "number") return undefined;
  return value.toLocaleString("en-US");
}
