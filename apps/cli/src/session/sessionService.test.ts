import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SessionStore } from "@micro-harnesses/core";
import { SessionService } from "./sessionService.js";

test("session service reads telemetry summary", async () => {
  const stateDir = await mkTmpDir();
  const store = new SessionStore(stateDir);
  const session = await store.initSession({ sessionId: "s-1", goal: "goal" });
  const telemetryDir = path.join(stateDir, "sessions", session.sessionId, "telemetry");
  await mkdir(telemetryDir, { recursive: true });
  await writeFile(
    path.join(telemetryDir, "metrics.jsonl"),
    `${JSON.stringify({ name: "agent.iterations", value: 4 })}\n` +
      `${JSON.stringify({ name: "model.tokens", value: 30, attributes: { direction: "input" } })}\n` +
      `${JSON.stringify({ name: "model.tokens", value: 10, attributes: { direction: "output" } })}\n` +
      `${JSON.stringify({ name: "errors", value: 2 })}\n`,
    "utf8",
  );
  const service = new SessionService(stateDir);
  const details = await service.getDetails("s-1");
  assert.equal(details.telemetry.turns, 4);
  assert.equal(details.telemetry.inputTokens, 30);
  assert.equal(details.telemetry.outputTokens, 10);
  assert.equal(details.telemetry.errors, 2);
  assert.equal(details.artifacts.plan.exists, false);
});

test("session service reports saved plan artifacts", async () => {
  const stateDir = await mkTmpDir();
  const store = new SessionStore(stateDir);
  await store.initSession({ sessionId: "s-plan", goal: "goal" });
  await store.savePlan("s-plan", "# Plan\n\n- first\n");

  const service = new SessionService(stateDir);
  const details = await service.getDetails("s-plan");
  assert.equal(details.artifacts.plan.exists, true);
  assert.equal(details.artifacts.plan.path.endsWith(path.join("s-plan", "plan.md")), true);
  assert.equal((details.artifacts.plan.sizeBytes ?? 0) > 0, true);
});

async function mkTmpDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `mh-cli-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}
