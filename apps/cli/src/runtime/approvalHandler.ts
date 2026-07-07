import { access, readFile } from "node:fs/promises";
import { type ApprovalHandler, type ApprovalRequest, safeResolve } from "@micro-harnesses/core";
import type { HarnessMode } from "@micro-harnesses/core";
import { createPatch } from "diff";
import { asString } from "../shared/values.js";

export interface ApprovalView {
  request: ApprovalRequest;
  preview: string;
}

interface PendingApproval {
  view: ApprovalView;
  resolve: (approved: boolean) => void;
}

export type ApprovalListener = (pending: ApprovalView | undefined) => void;

export class ApprovalController {
  private readonly rootDir: string;
  private readonly sessionAlwaysAllowTools = new Set<string>();
  private readonly listeners = new Set<ApprovalListener>();
  private pending: PendingApproval | undefined;
  private interactive: boolean;

  constructor(rootDir: string, interactive = false) {
    this.rootDir = rootDir;
    this.interactive = interactive;
  }

  /** Enables/disables interactive approval prompts (chat vs headless). */
  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
  }

  createHandler(getMode: () => HarnessMode): ApprovalHandler {
    return async (request) => {
      const mode = getMode();
      if (mode === "autopilot") return true;
      if (this.sessionAlwaysAllowTools.has(request.tool.name)) return true;
      if (!this.interactive) return false;

      const preview = await buildPreview(request, this.rootDir);
      return await new Promise<boolean>((resolve) => {
        this.pending = { view: { request, preview }, resolve };
        this.notify();
      });
    };
  }

  subscribe(listener: ApprovalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
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
    } else {
      pending.resolve(decision === "approve");
    }
    this.notify();
    return true;
  }

  /** Rejects any in-flight approval so a killed run does not hang awaiting input. */
  cancelPending(): boolean {
    if (!this.pending) return false;
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(false);
    this.notify();
    return true;
  }

  private notify(): void {
    const view = this.pending?.view;
    for (const listener of this.listeners) {
      listener(view);
    }
  }
}

async function buildPreview(request: ApprovalRequest, rootDir: string): Promise<string> {
  const input = request.call.input;
  if (request.tool.name === "fs_write") {
    const filePath = asString(input.path);
    const content = asString(input.content);
    if (!filePath || content === undefined) return JSON.stringify(input, null, 2);
    const previous = await safeReadWithinRoot(rootDir, filePath);
    return createPatch(filePath, previous, content, "before", "after");
  }
  if (request.tool.name === "fs_append") {
    const filePath = asString(input.path);
    const content = asString(input.content);
    if (!filePath || content === undefined) return JSON.stringify(input, null, 2);
    const previous = await safeReadWithinRoot(rootDir, filePath);
    const next = `${previous}${content}`;
    return createPatch(filePath, previous, next, "before", "after");
  }
  if (request.tool.name === "shell_exec") {
    return `Command:\n${asString(input.command) ?? "<missing command>"}`;
  }
  return JSON.stringify(input, null, 2);
}

async function safeReadWithinRoot(rootDir: string, requestedPath: string): Promise<string> {
  let target: string;
  try {
    target = safeResolve(rootDir, requestedPath);
  } catch {
    // Path escapes the workspace root; do not read it for the preview.
    return "";
  }
  try {
    await access(target);
    return await readFile(target, "utf8");
  } catch {
    return "";
  }
}
