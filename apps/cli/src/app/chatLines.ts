import type { ApprovalView } from "../runtime/approvalHandler.js";
import type { ChatEntry } from "./transcript.js";
import { tailTextLines } from "./viewport.js";

export interface SubagentStatus {
  sessionId: string;
  startedAt?: number;
  name?: string;
  promptName?: string;
  goal?: string;
  anchorTurnId?: string;
  anchorIteration?: number;
  model?: string;
  status: "running" | "completed" | "failed";
  activity?: string;
  summary?: string;
  error?: string;
  thinkingText?: string;
  outputText?: string;
  recentTools?: string[];
}

export interface ChatRenderLine {
  id: string;
  indicator: string;
  indicatorColor?: "gray" | "cyan" | "yellow" | "green" | "blue" | "magenta" | "white";
  text: string;
  textColor?: "gray" | "cyan" | "yellow" | "green" | "white" | "magenta";
  backgroundColor?: "black" | "blackBright";
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
  let hiddenSubagentCount = 0;
  const anchoredSubagents = new Map<string, SubagentStatus[]>();
  const unanchoredSubagents: SubagentStatus[] = [];
  const normalizedSubagents = subagents
    .slice()
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  for (const subagent of normalizedSubagents) {
    if (subagent.anchorTurnId) {
      const key = anchorKey(subagent.anchorTurnId, subagent.anchorIteration);
      const list = anchoredSubagents.get(key) ?? [];
      list.push(subagent);
      anchoredSubagents.set(key, list);
    } else {
      unanchoredSubagents.push(subagent);
    }
  }

  const userStyle: LineStyle = { indicator: "❯ ", indicatorColor: "magenta", textColor: "magenta" };
  const thinkingHeaderStyle: LineStyle = { indicator: "◌ ", indicatorColor: "yellow" };
  const thinkingBodyStyle: LineStyle = { indicator: "  ", textColor: "gray" };
  const assistantStyle: LineStyle = { indicator: "● ", indicatorColor: "cyan", textColor: "white" };
  const systemStyle: LineStyle = {
    indicator: "∙ ",
    indicatorColor: "gray",
    textColor: "white",
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
      pushWrapped(
        lines,
        `${entry.id}-spacer-user`,
        { indicator: "  ", textColor: "gray" },
        "",
        columns,
      );
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
          pushBoundedMultiline(
            lines,
            `${step.id}-think`,
            thinkingBodyStyle,
            step.thinkingText,
            columns,
            8,
          );
        }
      }
      if (step.assistantText.length > 0) {
        pushMultiline(lines, `${step.id}-assistant`, assistantStyle, step.assistantText, columns);
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
      const stepSubagents = anchoredSubagents.get(anchorKey(entry.turn.id, step.iteration)) ?? [];
      for (const subagent of stepSubagents) {
        pushSubagentBlock(lines, subagent, columns, preferences.thinkingExpanded);
      }
      pushWrapped(lines, `${step.id}-spacer`, { indicator: "  ", textColor: "gray" }, "", columns);
    }
  }

  if (compressing) {
    if (preferences.diagnosticsExpanded) {
      pushWrapped(lines, "compressing", systemStyle, "Compressing context...", columns);
    } else {
      hiddenSystemCount += 1;
    }
  }

  if (unanchoredSubagents.length > 0) {
    if (preferences.diagnosticsExpanded) {
      pushWrapped(lines, "subagents-unanchored-header", systemStyle, "subagents", columns);
      for (const subagent of unanchoredSubagents) {
        pushSubagentBlock(lines, subagent, columns, preferences.thinkingExpanded);
      }
    } else {
      hiddenSubagentCount = unanchoredSubagents.length;
    }
  }

  if (pendingApproval) {
    pushWrapped(
      lines,
      "approval-title",
      {
        indicator: "∙ ",
        indicatorColor: "yellow",
        textColor: "white",
      },
      `approval required: ${pendingApproval.request.tool.name} (y=approve, n=reject, a=always)`,
      columns,
    );
    pushMultiline(
      lines,
      "approval-preview",
      {
        indicator: "∙ ",
        indicatorColor: "gray",
        textColor: "white",
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
    if (hiddenSubagentCount > 0) {
      pushWrapped(
        lines,
        "diag-subagents-collapsed",
        systemStyle,
        `${hiddenSubagentCount} subagent update(s) hidden`,
        columns,
      );
    }
    if (hiddenTotal > 0 || hiddenSubagentCount > 0) {
      pushWrapped(
        lines,
        "diag-hint",
        { indicator: "∙ ", indicatorColor: "gray", textColor: "white" },
        "press Ctrl+Y to expand diagnostics",
        columns,
      );
    }
  }

  return lines;
}

function iterationPrefixFor(iteration: number | undefined): string {
  return typeof iteration === "number" && iteration > 1 ? `#${iteration} ` : "";
}

function pushSubagentBlock(
  lines: ChatRenderLine[],
  subagent: SubagentStatus,
  columns: number,
  thinkingExpanded: boolean,
): void {
  const name = subagentDisplayName(subagent);
  const status =
    subagent.status === "running"
      ? "[running]"
      : subagent.status === "completed"
        ? "[done]"
        : "[failed]";
  pushWrapped(
    lines,
    `subagent-${subagent.sessionId}-header`,
    {
      indicator: "sub > ",
      indicatorColor:
        subagent.status === "running"
          ? "cyan"
          : subagent.status === "completed"
            ? "green"
            : "yellow",
    },
    `${name} ${status}`,
    columns,
  );

  const details: string[] = [];
  if (subagent.promptName) details.push(`persona=${subagent.promptName}`);
  if (subagent.model) details.push(`model=${subagent.model}`);
  if (subagent.activity) details.push(`activity=${subagent.activity}`);
  if (subagent.goal) details.push(`goal=${subagent.goal}`);
  pushWrapped(
    lines,
    `subagent-${subagent.sessionId}-meta`,
    { indicator: "       ", textColor: "gray" },
    details.join(" | "),
    columns,
  );
  if (subagent.thinkingText && subagent.thinkingText.length > 0) {
    const state = thinkingExpanded ? "[expanded]" : "[collapsed]";
    pushWrapped(
      lines,
      `subagent-${subagent.sessionId}-thinking-label`,
      { indicator: "       ", textColor: "yellow" },
      `thinking ${state}:`,
      columns,
    );
    if (thinkingExpanded) {
      pushBoundedMultiline(
        lines,
        `subagent-${subagent.sessionId}-thinking`,
        { indicator: "       ", textColor: "gray" },
        subagent.thinkingText,
        columns,
        5,
      );
    }
  }
  if (subagent.outputText && subagent.outputText.length > 0) {
    pushWrapped(
      lines,
      `subagent-${subagent.sessionId}-output-label`,
      { indicator: "       ", textColor: "green" },
      "output:",
      columns,
    );
    pushBoundedMultiline(
      lines,
      `subagent-${subagent.sessionId}-output`,
      { indicator: "       ", textColor: "gray" },
      subagent.outputText,
      columns,
      6,
    );
  }
  if (subagent.summary && subagent.summary.length > 0) {
    pushWrapped(
      lines,
      `subagent-${subagent.sessionId}-summary`,
      { indicator: "       ", textColor: "green" },
      `summary: ${subagent.summary}`,
      columns,
    );
  }
  if (subagent.error && subagent.error.length > 0) {
    pushWrapped(
      lines,
      `subagent-${subagent.sessionId}-error`,
      { indicator: "       ", textColor: "yellow" },
      `error: ${subagent.error}`,
      columns,
    );
  }
  if (subagent.recentTools && subagent.recentTools.length > 0) {
    pushWrapped(
      lines,
      `subagent-${subagent.sessionId}-tools`,
      { indicator: "       ", textColor: "gray" },
      `tools: ${subagent.recentTools.join(" | ")}`,
      columns,
    );
  }
}

function anchorKey(turnId: string, iteration: number | undefined): string {
  return `${turnId}:${iteration ?? 1}`;
}

function subagentDisplayName(subagent: SubagentStatus): string {
  return subagent.name ?? subagent.promptName ?? "subagent";
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
    pushWrapped(
      lines,
      `${idPrefix}-${index}`,
      index === 0 ? style : continuationStyle,
      segment,
      columns,
    );
  });
}

function pushBoundedMultiline(
  lines: ChatRenderLine[],
  idPrefix: string,
  style: LineStyle,
  text: string,
  columns: number,
  maxLines: number,
): void {
  const tail = tailTextLines(text, maxLines);
  if (tail.hidden > 0) {
    pushWrapped(
      lines,
      `${idPrefix}-truncated`,
      { indicator: style.indicator, textColor: "gray" },
      `... ${tail.hidden} line(s) hidden`,
      columns,
    );
  }
  pushMultiline(lines, idPrefix, style, tail.visible.join("\n"), columns);
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
