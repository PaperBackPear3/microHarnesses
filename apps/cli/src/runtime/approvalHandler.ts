import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ApprovalHandler, ApprovalRequest } from "@micro-harnesses/core";
import { createPatch } from "diff";
import type { CliMode } from "../modes/modes";

export interface ApprovalView {
  request: ApprovalRequest;
  preview: string;
}

interface PendingApproval {
  view: ApprovalView;
  resolve: (approved: boolean) => void;
}

export class ApprovalController {
  private readonly rootDir: string;
  private readonly sessionAlwaysAllowTools = new Set<string>();
  private pending: PendingApproval | undefined;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  createHandler(getMode: () => CliMode, isInteractive: boolean): ApprovalHandler {
    return async (request) => {
      const mode = getMode();
      if (mode === "autopilot") return true;
      if (this.sessionAlwaysAllowTools.has(request.tool.name)) return true;
      if (!isInteractive) return false;

      const preview = await buildPreview(request, this.rootDir);
      return await new Promise<boolean>((resolve) => {
        this.pending = {
          view: { request, preview },
          resolve,
        };
      });
    };
  }

  getPending(): ApprovalView | undefined {
    return this.pending?.view;
  }

  resolvePending(decision: "approve" | "reject" | "always"): boolean {
    if (!this.pending) return false;
    const pending = this.pending;
    this.pending = undefined;
    if (decision === "always") {
      this.sessionAlwaysAllowTools.add(pending.view.request.tool.name);
      pending.resolve(true);
      return true;
    }
    pending.resolve(decision === "approve");
    return true;
  }
}

async function buildPreview(request: ApprovalRequest, rootDir: string): Promise<string> {
  const input = request.call.input;
  if (request.tool.name === "fs_write") {
    const filePath = asString(input.path);
    const content = asString(input.content);
    if (!filePath || content === undefined) return JSON.stringify(input, null, 2);
    const target = path.resolve(rootDir, filePath);
    const previous = await safeRead(target);
    return createPatch(filePath, previous, content, "before", "after");
  }
  if (request.tool.name === "fs_append") {
    const filePath = asString(input.path);
    const content = asString(input.content);
    if (!filePath || content === undefined) return JSON.stringify(input, null, 2);
    const target = path.resolve(rootDir, filePath);
    const previous = await safeRead(target);
    const next = `${previous}${content}`;
    return createPatch(filePath, previous, next, "before", "after");
  }
  if (request.tool.name === "shell_exec") {
    return `Command:\n${asString(input.command) ?? "<missing command>"}`;
  }
  return JSON.stringify(input, null, 2);
}

async function safeRead(filePath: string): Promise<string> {
  try {
    await access(filePath);
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
