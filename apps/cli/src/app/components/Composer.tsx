import { Text, useInput, usePaste } from "ink";
import type { Key } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { containsTerminalMouseSequence } from "../mouseSequences.js";

interface Props {
  value: string;
  disabled?: boolean;
  columns?: number;
  onChange(value: string): void;
  onSubmit(value: string): void;
}

const CURSOR_GLYPH = "█";
const MAX_COMPOSER_ROWS = 6;
const ENTER_SUBMIT_SEQUENCES = new Set(["\u001b[13;1u", "\u001b[27;1;13~"]);
const ENTER_NEWLINE_SEQUENCES = new Set(["\u001b[13;2u", "\u001b[27;2;13~"]);

export function clipeRenderedToMaxRows(rendered: string, columns: number, maxRows: number): string {
  const safeColumns = Math.max(1, columns);
  const lines = rendered.split("\n");
  let currentRows = 0;
  const clipped: string[] = [];

  for (const line of lines) {
    const lineLength = Math.max(1, line.length);
    const lineRows = Math.ceil(lineLength / safeColumns);
    if (currentRows + lineRows > maxRows) {
      const remainingColumns = (maxRows - currentRows) * safeColumns;
      clipped.push(line.slice(0, Math.max(0, remainingColumns - 1)));
      break;
    }
    clipped.push(line);
    currentRows += lineRows;
  }

  return clipped.join("\n");
}

export function Composer({ value, disabled, columns, onChange, onSubmit }: Props): ReactElement {
  const [cursor, setCursor] = useState(value.length);

  useEffect(() => {
    setCursor((current) => clampCursor(current, value));
  }, [value]);

  const displayColumns = Math.max(1, columns ?? process.stdout.columns ?? 80);
  const displayedValue = useMemo(
    () => renderComposerValue(value, cursor, displayColumns),
    [displayColumns, value, cursor],
  );

  const insertChunk = useCallback(
    (chunk: string) => {
      if (disabled || chunk.length === 0) return;
      const next = insertAtCursor(value, cursor, chunk);
      onChange(next.text);
      setCursor(next.cursor);
    },
    [cursor, disabled, onChange, value],
  );

  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (disabled) return;
      if (containsTerminalMouseSequence(input)) return;

      const enterAction = classifyComposerEnterAction(input, key);
      if (enterAction === "newline") {
        insertChunk("\n");
        return;
      }
      if (enterAction === "submit") {
        onSubmit(value);
        return;
      }

      if (key.backspace) {
        const next = deleteBackward(value, cursor);
        if (!next) return;
        onChange(next.text);
        setCursor(next.cursor);
        return;
      }

      if (key.delete) {
        const next = deleteForward(value, cursor);
        if (!next) return;
        onChange(next.text);
        setCursor(next.cursor);
        return;
      }

      if (key.leftArrow) {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }

      if (key.rightArrow) {
        setCursor((current) => Math.min(value.length, current + 1));
        return;
      }

      if (key.upArrow) {
        setCursor((current) => moveCursorVertically(value, current, -1));
        return;
      }

      if (key.downArrow) {
        setCursor((current) => moveCursorVertically(value, current, 1));
        return;
      }

      if (key.home) {
        setCursor((current) => lineStart(value, current));
        return;
      }

      if (key.end) {
        setCursor((current) => lineEnd(value, current));
        return;
      }

      if (key.ctrl || key.escape || key.tab) {
        return;
      }

      if (input.length > 0) {
        insertChunk(input);
      }
    },
    [cursor, disabled, insertChunk, onChange, onSubmit, value],
  );

  useInput(handleInput);
  usePaste(insertChunk, { isActive: !disabled });

  return <Text>{displayedValue}</Text>;
}

export function classifyComposerEnterAction(
  input: string,
  key: Pick<Key, "return" | "shift" | "ctrl">,
): "submit" | "newline" | undefined {
  if (key.return && key.shift) return "newline";
  if (key.return) return "submit";
  if (ENTER_NEWLINE_SEQUENCES.has(input)) return "newline";
  if (ENTER_SUBMIT_SEQUENCES.has(input)) return "submit";
  return undefined;
}

export function estimateComposerRows(value: string, columns: number): number {
  const safeColumns = Math.max(1, columns);
  const rendered = withCursor(value, clampCursor(value.length, value));
  const logicalLines = rendered.split("\n");
  const rows = logicalLines.reduce((sum, line) => {
    const lineLength = Math.max(1, line.length);
    return sum + Math.ceil(lineLength / safeColumns);
  }, 0);
  return Math.max(1, Math.min(MAX_COMPOSER_ROWS, rows));
}

export function insertAtCursor(
  value: string,
  cursor: number,
  chunk: string,
): { text: string; cursor: number } {
  const safeCursor = clampCursor(cursor, value);
  const normalizedChunk = chunk.replace(/\r\n?/g, "\n");
  const text = `${value.slice(0, safeCursor)}${normalizedChunk}${value.slice(safeCursor)}`;
  return { text, cursor: safeCursor + normalizedChunk.length };
}

export function deleteBackward(
  value: string,
  cursor: number,
): { text: string; cursor: number } | undefined {
  const safeCursor = clampCursor(cursor, value);
  if (safeCursor === 0) return undefined;
  const text = `${value.slice(0, safeCursor - 1)}${value.slice(safeCursor)}`;
  return { text, cursor: safeCursor - 1 };
}

export function deleteForward(
  value: string,
  cursor: number,
): { text: string; cursor: number } | undefined {
  const safeCursor = clampCursor(cursor, value);
  if (safeCursor >= value.length) return undefined;
  const text = `${value.slice(0, safeCursor)}${value.slice(safeCursor + 1)}`;
  return { text, cursor: safeCursor };
}

export function moveCursorVertically(value: string, cursor: number, direction: -1 | 1): number {
  const safeCursor = clampCursor(cursor, value);
  const currentStart = lineStart(value, safeCursor);
  const currentColumn = safeCursor - currentStart;
  const targetStart =
    direction < 0 ? previousLineStart(value, currentStart) : nextLineStart(value, currentStart);
  if (targetStart === undefined) return safeCursor;
  const targetEnd = lineEnd(value, targetStart);
  return Math.min(targetStart + currentColumn, targetEnd);
}

export function lineStart(value: string, cursor: number): number {
  const safeCursor = clampCursor(cursor, value);
  const index = value.lastIndexOf("\n", Math.max(0, safeCursor - 1));
  return index === -1 ? 0 : index + 1;
}

export function lineEnd(value: string, cursor: number): number {
  const safeCursor = clampCursor(cursor, value);
  const index = value.indexOf("\n", safeCursor);
  return index === -1 ? value.length : index;
}

export function withCursor(value: string, cursor: number): string {
  const safeCursor = clampCursor(cursor, value);
  return `${value.slice(0, safeCursor)}${CURSOR_GLYPH}${value.slice(safeCursor)}`;
}

export function renderComposerValue(value: string, cursor: number, columns: number): string {
  const safeColumns = Math.max(1, columns);
  const visualLines = toVisualLines(withCursor(value, cursor), safeColumns);
  const cursorLine = Math.max(
    0,
    visualLines.findIndex((line) => line.includes(CURSOR_GLYPH)),
  );
  const start = clampWindowStart(cursorLine, visualLines.length, MAX_COMPOSER_ROWS);
  return visualLines.slice(start, start + MAX_COMPOSER_ROWS).join("\n");
}

function previousLineStart(value: string, currentLineStart: number): number | undefined {
  if (currentLineStart === 0) return undefined;
  const previousBreak = value.lastIndexOf("\n", Math.max(0, currentLineStart - 2));
  return previousBreak === -1 ? 0 : previousBreak + 1;
}

function nextLineStart(value: string, currentLineStart: number): number | undefined {
  const currentEnd = lineEnd(value, currentLineStart);
  if (currentEnd >= value.length) return undefined;
  return currentEnd + 1;
}

function clampCursor(cursor: number, value: string): number {
  return Math.max(0, Math.min(cursor, value.length));
}

function toVisualLines(value: string, columns: number): string[] {
  const visualLines: string[] = [];
  for (const logicalLine of value.split("\n")) {
    if (logicalLine.length === 0) {
      visualLines.push("");
      continue;
    }
    for (let index = 0; index < logicalLine.length; index += columns) {
      visualLines.push(logicalLine.slice(index, index + columns));
    }
  }
  return visualLines.length > 0 ? visualLines : [""];
}

function clampWindowStart(cursorLine: number, lineCount: number, maxRows: number): number {
  if (lineCount <= maxRows) return 0;
  const preferredStart = cursorLine - Math.floor(maxRows / 2);
  return Math.max(0, Math.min(preferredStart, lineCount - maxRows));
}
