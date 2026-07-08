import type { EffortLevel, HarnessMode } from "@micro-harnesses/core";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { StatusState } from "../../telemetry/status.js";
import type { SubagentStatus } from "../chatLines.js";

export function FooterStatusBar(props: {
  sessionId: string;
  cliVersion: string;
  mode: HarnessMode;
  effort: EffortLevel;
  promptName: string;
  provider: string;
  modelLabel: string;
  routingPreference?: string;
  contextStyle: { label: string; color: string };
  running: boolean;
  status: StatusState;
  subagents: SubagentStatus[];
  shortcutHint: string;
  columns: number;
}): ReactElement {
  const runningSubagents = props.subagents.filter((entry) => entry.status === "running").length;
  const finishedSubagents = props.subagents.filter((entry) => entry.status !== "running").length;
  const line1 = trimToColumns(
    [
      `v${props.cliVersion}`,
      `session=${props.sessionId}`,
      `mode=${props.mode}`,
      `effort=${props.effort}`,
      `persona=${props.promptName}`,
      `provider=${props.provider}`,
      props.modelLabel,
      props.routingPreference ? `route=${props.routingPreference}` : "",
      props.contextStyle.label,
    ]
      .filter(Boolean)
      .join(" | "),
    props.columns,
  );
  const line2 = trimToColumns(
    [
      `tokens=${props.status.tokensIn}/${props.status.tokensOut}`,
      `turns=${props.status.turns}`,
      `errors=${props.status.errors}`,
      `limits=${props.status.limitHits}`,
      `subagents=${runningSubagents} running/${finishedSubagents} done`,
      props.status.compressing ? "COMPRESSING" : "",
      props.running ? "RUNNING" : "",
    ]
      .filter(Boolean)
      .join(" | "),
    props.columns,
  );
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      backgroundColor="black"
    >
      <Text color="whiteBright">{line1}</Text>
      <Text color="gray">{line2}</Text>
      <Text color="cyan">{trimToColumns(props.shortcutHint, props.columns)}</Text>
    </Box>
  );
}

function trimToColumns(text: string, columns: number): string {
  if (text.length <= columns) return text;
  if (columns <= 1) return "…";
  return `${text.slice(0, Math.max(0, columns - 1))}…`;
}
