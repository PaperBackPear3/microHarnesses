export function containsTerminalMouseSequence(raw: string): boolean {
  if (raw.length === 0) return false;

  let index = 0;
  while (index < raw.length) {
    const next = consumeMouseSequence(raw, index);
    if (next === undefined) return false;
    index = next;
  }
  return true;
}

export function parseMouseWheelDelta(raw: string): number {
  if (!containsTerminalMouseSequence(raw)) return 0;
  if (raw.includes("<64;")) return 3;
  if (raw.includes("<65;")) return -3;
  return 0;
}

function consumeMouseSequence(raw: string, start: number): number | undefined {
  let index = start;
  if (raw.startsWith("\u001b[<", index)) {
    index += 3;
  } else if (raw.startsWith("[<", index)) {
    index += 2;
  } else {
    return undefined;
  }

  const buttonEnd = consumeDigits(raw, index);
  if (buttonEnd === undefined || raw[buttonEnd] !== ";") return undefined;
  const columnEnd = consumeDigits(raw, buttonEnd + 1);
  if (columnEnd === undefined || raw[columnEnd] !== ";") return undefined;
  const rowEnd = consumeDigits(raw, columnEnd + 1);
  if (rowEnd === undefined) return undefined;
  return raw[rowEnd] === "M" || raw[rowEnd] === "m" ? rowEnd + 1 : undefined;
}

function consumeDigits(raw: string, start: number): number | undefined {
  let index = start;
  while (index < raw.length && raw[index] >= "0" && raw[index] <= "9") {
    index += 1;
  }
  return index > start ? index : undefined;
}
