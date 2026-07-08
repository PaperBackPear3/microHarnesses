import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalSession } from "./terminalSession.js";

test("terminal session enters and leaves alternate screen for interactive terminals", () => {
  const writes: string[] = [];
  const session = createTerminalSession({
    isTTY: true,
    write(chunk) {
      writes.push(chunk);
      return true;
    },
  });

  session.enter();
  session.leave();

  assert.deepEqual(writes, ["\u001b[?1049h\u001b[?25l", "\u001b[?25h\u001b[?1049l"]);
});

test("terminal session is idempotent", () => {
  const writes: string[] = [];
  const session = createTerminalSession({
    isTTY: true,
    write(chunk) {
      writes.push(chunk);
      return true;
    },
  });

  session.enter();
  session.enter();
  session.leave();
  session.leave();

  assert.deepEqual(writes, ["\u001b[?1049h\u001b[?25l", "\u001b[?25h\u001b[?1049l"]);
});

test("terminal session is a no-op when stdout is not interactive", () => {
  const writes: string[] = [];
  const session = createTerminalSession({
    isTTY: false,
    write(chunk) {
      writes.push(chunk);
      return true;
    },
  });

  session.enter();
  session.leave();

  assert.deepEqual(writes, []);
});
