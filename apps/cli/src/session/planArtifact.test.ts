import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "@micro-harnesses/core";
import { savePlanArtifactIfNeeded, toPlanMarkdown } from "./planArtifact.js";

test("toPlanMarkdown adds heading when absent", () => {
  assert.equal(toPlanMarkdown("first\nsecond"), "# Plan\n\nfirst\nsecond\n");
});

test("savePlanArtifactIfNeeded saves plan in plan mode", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-plan-artifact-"));
  const store = new SessionStore(stateDir);
  await store.initSession({ sessionId: "s-1", goal: "plan" });
  try {
    const saved = await savePlanArtifactIfNeeded({
      mode: "plan",
      sessionStore: store,
      sessionId: "s-1",
      assistantMessage: "Do this next",
    });
    assert.ok(saved);
    const loaded = await store.readPlan("s-1");
    assert.ok(loaded);
    assert.equal(loaded?.content.startsWith("# Plan"), true);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
