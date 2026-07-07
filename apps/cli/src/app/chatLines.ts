import type { ApprovalView } from "../runtime/approvalHandler.js";
import type { ChatEntry } from "./transcript.js";

export interface SubagentStatus {
  sessionId: string;
  promptName: string;
  goal?: string;
  model?: string;
  status: "running" | "completed" | "failed";
  activity?: string;
  summary?: string;
}

export interface ChatRenderLine {
  id: string;
  indicator: string;
  indicatorColor?: "gray" | "cyan" | "yellow" | "green" | "blue";
  text: string;
  textColor?: "gray" | "cyan" | "yellow" | "green";
}

interface LineStyle {
  indicator: string;
  indicatorColor?: ChatRenderLine["indicatorColor"];
  textColor?: ChatRenderLine["textColor"];
}

export interface ViewPreferences {
  thinkingExpanded: boolean;
  diagnosticsExpanded: boolean;
}

export function buildChatLines(
  entries: ChatEntry[],
  subagents: SubagentStatus[],
  compressing: boolean,
  pendingApproval: ApprovalView | undefined,
  columns: number,
  preferences: ViewPreferences,
): ChatRenderLine[] {
  const lines: ChatRenderLine[] = [];
  let hiddenSystemCount = 0;
  let hiddenStepSystemCount = 0;
  let hiddenRunningSubagents = 0;

  const userStyle: LineStyle = { indicator: "user > ", indicatorColor: "blue" };
  const thinkingHeaderStyle: LineStyle = { indicator: "think > ", indicatorColor: "yellow" };
  const thinkingBodyStyle: LineStyle = { indicator: "       ", textColor: "gray" };
  const assistantStyle: LineStyle = { indicator: "agent > ", indicatorColor: "green" };
  const systemStyle: LineStyle = {
    indicator: "diag > ",
    indicatorColor: "gray",
    textColor: "gray",
  };

  for (const entry of entries) {
    if (entry.type === "system") {
      if (preferences.diagnosticsExpanded) {
        pushWrapped(lines, entry.id, systemStyle, entry.text ?? "", columns);
      } else {
        hiddenSystemCount += 1;
      }
      continue;
    }
    if (!entry.turn) continue;
    if (entry.turn.userText) {
      pushWrapped(lines, `${entry.id}-user`, userStyle, entry.turn.userText, columns);
    }
    for (const step of entry.turn.steps) {
      if (step.thinkingText.length > 0) {
        const iterationPrefix = iterationPrefixFor(step.iteration);
        const state = preferences.thinkingExpanded ? "[expanded]" : "[collapsed]";
        pushWrapped(
          lines,
          `${step.id}-think-header`,
          thinkingHeaderStyle,
          `${iterationPrefix}${state}`,
          columns,
        );
        if (preferences.thinkingExpanded) {
          pushMultiline(lines, `${step.id}-think`, thinkingBodyStyle, step.thinkingText, columns);
        }
      }
      if (step.assistantText.length > 0) {
        pushMultiline(
          lines,
          `${step.id}-assistant`,
          assistantStyle,
          step.assistantText,
          columns,
        );
      }
      for (const message of step.systemMessages) {
        if (preferences.diagnosticsExpanded) {
          pushWrapped(
            lines,
            `${step.id}-sys-${message.id}`,
            systemStyle,
            `${iterationPrefixFor(step.iteration)}${message.text}`,
            columns,
          );
        } else {
          hiddenStepSystemCount += 1;
        }
      }
    }
  }

  if (compressing) {
    if (preferences.diagnosticsExpanded) {
      pushWrapped(lines, "compressing", systemStyle, "Compressing context...", columns);
    } else {
      hiddenSystemCount += 1;
    }
  }

  const runningSubagents = subagents.filter((entry) => entry.status === "running");
  if (runningSubagents.length > 0) {
    if (preferences.diagnosticsExpanded) {
      pushWrapped(
        lines,
        "subagents-header",
        systemStyle,
        `subagents running ${runningSubagents.length}`,
        columns,
      );
      for (const subagent of runningSubagents) {
        const activity = subagent.activity ? ` | ${subagent.activity}` : "";
        const model = subagent.model ? ` | model=${subagent.model}` : "";
        pushWrapped(
          lines,
          `subagent-${subagent.sessionId}`,
          systemStyle,
          `[running] ${subagent.promptName} (${subagent.sessionId})${activity}${model}`,
          columns,
        );
      }
    } else {
      hiddenRunningSubagents = runningSubagents.length;
    }
  }

  const finishedSubagents = subagents.filter((entry) => entry.status !== "running").slice(0, 5);
  if (finishedSubagents.length > 0) {
    pushWrapped(
      lines,
      "subagents-finished-header",
      { indicator: "sub > ", indicatorColor: "gray", textColor: "gray" },
      `recent finished ${finishedSubagents.length}`,
      columns,
    );
    for (const subagent of finishedSubagents) {
      const status =
        subagent.status === "completed"
          ? "[done]"
          : subagent.status === "failed"
            ? "[failed]"
            : "[stopped]";
      const summary = subagent.summary ? ` ${subagent.summary}` : "";
      pushWrapped(
        lines,
        `subagent-finished-${subagent.sessionId}`,
        {
          indicator: "sub > ",
          indicatorColor: subagent.status === "completed" ? "green" : "yellow",
        },
        `${status} ${subagent.promptName}${summary}`,
        columns,
      );
    }
  }

  if (pendingApproval) {
    pushWrapped(
      lines,
      "approval-title",
      {
        indicator: "diag > ",
        indicatorColor: "yellow",
        textColor: "gray",
      },
      `approval required: ${pendingApproval.request.tool.name} (y=approve, n=reject, a=always)`,
      columns,
    );
    pushMultiline(
      lines,
      "approval-preview",
      {
        indicator: "diag > ",
        indicatorColor: "gray",
        textColor: "gray",
      },
      pendingApproval.preview.slice(0, 600),
      columns,
    );
  }

  if (!preferences.diagnosticsExpanded) {
    const hiddenTotal = hiddenSystemCount + hiddenStepSystemCount;
    if (hiddenTotal > 0) {
      pushWrapped(
        lines,
        "diag-collapsed",
        systemStyle,
        `${hiddenTotal} diagnostic updates hidden`,
        columns,
      );
    }
    if (hiddenRunningSubagents > 0) {
      pushWrapped(
        lines,
        "diag-running-collapsed",
        systemStyle,
        `${hiddenRunningSubagents} running subagent updates hidden`,
        columns,
      );
    }
    pushWrapped(
      lines,
      "diag-hint",
      { indicator: "diag > ", indicatorColor: "gray", textColor: "gray" },
      "press Ctrl+Y to expand diagnostics",
      columns,
    );
  }

  return lines;
}

function iterationPrefixFor(iteration: number | undefined): string {
  return typeof iteration === "number" && iteration > 1 ? `#${iteration} ` : "";
}

function pushMultiline(
  lines: ChatRenderLine[],
  idPrefix: string,
  style: LineStyle,
  text: string,
  columns: number,
): void {
  const continuationStyle: LineStyle = {
    indicator: " ".repeat(style.indicator.length),
    textColor: style.textColor,
  };
  const segments = text.split(/\r?\n/);
  segments.forEach((segment, index) => {
    pushWrapped(lines, `${idPrefix}-${index}`, index === 0 ? style : continuationStyle, segment, columns);
  });
}

function pushWrapped(
  lines: ChatRenderLine[],
  idPrefix: string,
  style: LineStyle,
  text: string,
  columns: number,
): void {
  const safeWidth = Math.max(10, columns);
  const indicator = style.indicator;
  const continuationIndicator = " ".repeat(indicator.length);
  const firstWidth = Math.max(1, safeWidth - indicator.length);
  if (text.length === 0) {
    lines.push({
      id: `${idPrefix}-0`,
      indicator,
      indicatorColor: style.indicatorColor,
      text: "",
      textColor: style.textColor,
    });
    return;
  }
  let start = 0;
  let index = 0;
  while (start < text.length) {
    const isFirst = index === 0;
    const width = isFirst ? firstWidth : safeWidth - continuationIndicator.length;
    lines.push({
      id: `${idPrefix}-${index}`,
      indicator: isFirst ? indicator : continuationIndicator,
      indicatorColor: isFirst ? style.indicatorColor : undefined,
      text: text.slice(start, start + width),
      textColor: style.textColor,
    });
    start += width;
    index += 1;
  }
}
