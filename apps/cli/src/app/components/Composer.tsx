import { Text, useInput } from "ink";
import type { Key } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

interface Props {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
  onSubmit(value: string): void;
}

const CURSOR_GLYPH = "█";
const MAX_COMPOSER_ROWS = 6;

export function Composer({ value, disabled, onChange, onSubmit }: Props): ReactElement {
  const [cursor, setCursor] = useState(value.length);

  useEffect(() => {
    setCursor((current) => clampCursor(current, value));
  }, [value]);

  const renderedValue = useMemo(() => withCursor(value, cursor), [value, cursor]);

  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (disabled) return;

      if (key.return) {
        if (key.meta) {
          const next = insertAtCursor(value, cursor, "\n");
          onChange(next.text);
          setCursor(next.cursor);
          return;
        }
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
        const next = insertAtCursor(value, cursor, input);
        onChange(next.text);
        setCursor(next.cursor);
      }
    },
    [cursor, disabled, onChange, onSubmit, value],
  );

  useInput(handleInput);

  return <Text>{renderedValue}</Text>;
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
  const text = `${value.slice(0, safeCursor)}${chunk}${value.slice(safeCursor)}`;
  return { text, cursor: safeCursor + chunk.length };
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
