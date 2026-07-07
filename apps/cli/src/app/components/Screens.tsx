import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { helpCommandLines, helpShortcutLines } from "../uiMeta.js";

export function Screen({ title, children }: { title: string; children: string }): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text color="cyan">{title}</Text>
      <Text>{children}</Text>
    </Box>
  );
}

export function HelpScreen({
  modelChoices,
  cliVersion,
}: {
  modelChoices: string[];
  cliVersion: string;
}): ReactElement {
  const commandLines = helpCommandLines(modelChoices);
  const shortcutLines = helpShortcutLines();
  const lines = [
    `Version: v${cliVersion}`,
    "",
    "Slash commands:",
    ...commandLines.map((line) => `  ${line}`),
    "",
    "Keyboard shortcuts:",
    ...shortcutLines.map((line) => `  ${line}`),
  ].join("\n");
  return <Screen title="Commands & Shortcuts">{lines}</Screen>;
}
