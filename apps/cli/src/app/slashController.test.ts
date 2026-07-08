import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ModeController } from "@micro-harnesses/core";
import type { CliComposition } from "../runtime/composition.js";
import { handleSlashCommand } from "./slashController.js";

function createComposition(promptsDir: string): CliComposition {
  return {
    modeController: new ModeController("accept-edits"),
    runtimeState: {
      provider: "openai",
      effort: "medium",
      promptName: "coder",
    },
    promptsDir,
  } as unknown as CliComposition;
}

function createChatStore() {
  const messages: string[] = [];
  return {
    messages,
    store: {
      appendSystemMessage(message: string) {
        messages.push(message);
      },
      clearChatEntries() {},
      getSnapshot() {
        return { running: false };
      },
      setRunning() {},
    },
  };
}

const noOp = () => {};
const noOpAsync = async () => {};

async function createPromptsDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-cli-slash-controller-"));
  const packs = ["coder", "planner"];
  for (const pack of packs) {
    const packDir = path.join(root, pack);
    await mkdir(packDir, { recursive: true });
    await writeFile(path.join(packDir, "system.md"), `${pack} system`, "utf8");
  }
  return root;
}

test("set-mode /plan switches to planner persona", async () => {
  const promptsDir = await createPromptsDir();
  try {
    const composition = createComposition(promptsDir);
    const chat = createChatStore();
    await handleSlashCommand({
      command: { type: "set-mode", mode: "plan" },
      composition,
      chatStore: chat.store as never,
      activeSessionId: "s-1",
      status: { tokensIn: 0, tokensOut: 0, turns: 0, errors: 0, limitHits: 0, compressing: false },
      setScreen: noOp,
      setScreenContent: noOp,
      setChatScrollOffset: noOp,
      switchToSession: noOpAsync,
      onExit: noOp,
    });
    assert.equal(composition.modeController.getMode(), "plan");
    assert.equal(composition.runtimeState.promptName, "planner");
  } finally {
    await rm(promptsDir, { recursive: true, force: true });
  }
});

test("set-mode /edits restores coder persona", async () => {
  const promptsDir = await createPromptsDir();
  try {
    const composition = createComposition(promptsDir);
    composition.modeController.setMode("plan");
    composition.runtimeState.promptName = "planner";
    const chat = createChatStore();
    await handleSlashCommand({
      command: { type: "set-mode", mode: "accept-edits" },
      composition,
      chatStore: chat.store as never,
      activeSessionId: "s-1",
      status: { tokensIn: 0, tokensOut: 0, turns: 0, errors: 0, limitHits: 0, compressing: false },
      setScreen: noOp,
      setScreenContent: noOp,
      setChatScrollOffset: noOp,
      switchToSession: noOpAsync,
      onExit: noOp,
    });
    assert.equal(composition.modeController.getMode(), "accept-edits");
    assert.equal(composition.runtimeState.promptName, "coder");
  } finally {
    await rm(promptsDir, { recursive: true, force: true });
  }
});

test("set-persona validates prompt pack existence", async () => {
  const promptsDir = await createPromptsDir();
  try {
    const composition = createComposition(promptsDir);
    const chat = createChatStore();
    await handleSlashCommand({
      command: { type: "set-persona", promptName: "missing-pack" },
      composition,
      chatStore: chat.store as never,
      activeSessionId: "s-1",
      status: { tokensIn: 0, tokensOut: 0, turns: 0, errors: 0, limitHits: 0, compressing: false },
      setScreen: noOp,
      setScreenContent: noOp,
      setChatScrollOffset: noOp,
      switchToSession: noOpAsync,
      onExit: noOp,
    });
    assert.equal(composition.runtimeState.promptName, "coder");
    assert.ok(chat.messages.at(-1)?.includes("Unknown persona"));
  } finally {
    await rm(promptsDir, { recursive: true, force: true });
  }
});
