export type CliMode = "plan" | "accept-edits" | "autopilot";

export const MODE_SEQUENCE: CliMode[] = ["plan", "accept-edits", "autopilot"];

export class ModeController {
  private mode: CliMode;

  constructor(initialMode: CliMode) {
    this.mode = initialMode;
  }

  getMode(): CliMode {
    return this.mode;
  }

  setMode(mode: CliMode): void {
    this.mode = mode;
  }

  cycle(): CliMode {
    const index = MODE_SEQUENCE.indexOf(this.mode);
    const next = MODE_SEQUENCE[(index + 1) % MODE_SEQUENCE.length] as CliMode;
    this.mode = next;
    return next;
  }
}

export function parseMode(input: string | undefined): CliMode | undefined {
  if (!input) return undefined;
  if (input === "plan" || input === "accept-edits" || input === "autopilot") {
    return input;
  }
  if (input === "edits") {
    return "accept-edits";
  }
  if (input === "auto") {
    return "autopilot";
  }
  return undefined;
}
