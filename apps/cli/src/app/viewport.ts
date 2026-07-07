export interface ViewportSlice<T> {
  visible: T[];
  maxOffset: number;
  offset: number;
}

export interface TextTailSlice {
  visible: string[];
  hidden: number;
}

export function sliceFromBottom<T>(
  lines: T[],
  rows: number,
  requestedOffset: number,
): ViewportSlice<T> {
  const safeRows = Math.max(1, Math.floor(rows));
  const maxOffset = Math.max(0, lines.length - safeRows);
  const offset = clamp(requestedOffset, 0, maxOffset);
  const end = lines.length - offset;
  const start = Math.max(0, end - safeRows);
  return {
    visible: lines.slice(start, end),
    maxOffset,
    offset,
  };
}

export function tailTextLines(text: string, maxLines: number): TextTailSlice {
  const lines = text.split(/\r?\n/);
  if (maxLines < 1) {
    return { visible: [], hidden: lines.length };
  }
  const hidden = Math.max(0, lines.length - maxLines);
  return { visible: lines.slice(Math.max(0, lines.length - maxLines)), hidden };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
