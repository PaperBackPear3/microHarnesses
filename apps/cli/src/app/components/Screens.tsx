import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { helpCommandLines, helpShortcutLines } from "../uiMeta.js";

export function Screen({ title, children }: { title: string; children: string }): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
      <Text color="cyanBright">{title}</Text>
      <Text color="whiteBright">{children}</Text>
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
  return (
    <Box flexDirection="column" gap={1}>
      <Screen title="CLI HELP">
        {`Version v${cliVersion}\nUse /commands anytime to reopen this panel.`}
      </Screen>
      <Box gap={1}>
        <Box flexGrow={1}>
          <Screen title="Slash Commands">
            {commandLines.map((line) => `  ${line}`).join("\n")}
          </Screen>
        </Box>
        <Box flexGrow={1}>
          <Screen title="Shortcuts">{shortcutLines.map((line) => `  ${line}`).join("\n")}</Screen>
        </Box>
      </Box>
    </Box>
  );
}
