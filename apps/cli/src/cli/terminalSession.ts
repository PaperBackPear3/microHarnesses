const ENTER_ALTERNATE_SCREEN = "\u001b[?1049h";
const LEAVE_ALTERNATE_SCREEN = "\u001b[?1049l";
const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";

interface TerminalOutput {
  isTTY?: boolean;
  write(chunk: string): boolean;
}

export interface TerminalSession {
  enter(): void;
  leave(): void;
}

export function createTerminalSession(output: TerminalOutput = process.stdout): TerminalSession {
  let active = false;
  const interactive = output.isTTY === true;

  return {
    enter() {
      if (!interactive || active) return;
      output.write(`${ENTER_ALTERNATE_SCREEN}${HIDE_CURSOR}`);
      active = true;
    },
    leave() {
      if (!interactive || !active) return;
      active = false;
      output.write(`${SHOW_CURSOR}${LEAVE_ALTERNATE_SCREEN}`);
    },
  };
}
