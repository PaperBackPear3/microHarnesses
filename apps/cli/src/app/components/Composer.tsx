import { Text, useInput } from "ink";
import type { Key } from "ink";
import { useCallback } from "react";
import type { ReactElement } from "react";

interface Props {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
  onSubmit(value: string): void;
}

export function Composer({ value, disabled, onChange, onSubmit }: Props): ReactElement {
  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (disabled) return;
      if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow) {
        return;
      }
      if (key.return) {
        onSubmit(value);
        return;
      }
      if (key.backspace || key.delete) {
        if (value.length > 0) onChange(value.slice(0, -1));
        return;
      }
      if (input.length === 1 && !key.shift) {
        onChange(`${value}${input}`);
        return;
      }
      if (input.length === 1 && key.shift) {
        onChange(`${value}${input}`);
      }
    },
    [disabled, onChange, onSubmit, value],
  );

  useInput(handleInput);

  return <Text>{value}</Text>;
}
