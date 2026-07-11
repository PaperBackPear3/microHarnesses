import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "@micro-harnesses/core";
import { sessionsCommand } from "./sessions.js";

function withCapturedStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  return run()
    .then(() => chunks.join(""))
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mh-cli-sessions-"));
  const previousHome = process.env.HOME;
  process.env.HOME = tempRoot;
  try {
    return await run(tempRoot);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("sessionsCommand list reads stateDir from config file", async () => {
  await withTempHome(async (homeDir) => {
    const configuredStateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-sessions-state-"));
    try {
      const configDir = path.join(homeDir, ".microharness");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(configDir, "config.json"),
        JSON.stringify({ stateDir: configuredStateDir }),
        "utf8",
      );

      const store = new SessionStore(configuredStateDir);
      await store.initSession({ sessionId: "s-from-config", goal: "check config state dir" });

      const output = await withCapturedStdout(async () => {
        await sessionsCommand({ sub: "list" });
      });

      const parsed = JSON.parse(output) as Array<{ sessionId: string }>;
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0]?.sessionId, "s-from-config");
    } finally {
      await rm(configuredStateDir, { recursive: true, force: true });
    }
  });
});

test("sessionsCommand explicit --state-dir override wins", async () => {
  await withTempHome(async (homeDir) => {
    const configuredStateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-sessions-configured-"));
    const overrideStateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-sessions-override-"));
    try {
      const configDir = path.join(homeDir, ".microharness");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(configDir, "config.json"),
        JSON.stringify({ stateDir: configuredStateDir }),
        "utf8",
      );

      const configuredStore = new SessionStore(configuredStateDir);
      await configuredStore.initSession({ sessionId: "s-configured", goal: "configured" });

      const overrideStore = new SessionStore(overrideStateDir);
      await overrideStore.initSession({ sessionId: "s-override", goal: "override" });

      const output = await withCapturedStdout(async () => {
        await sessionsCommand({ sub: "list", stateDir: overrideStateDir });
      });

      const parsed = JSON.parse(output) as Array<{ sessionId: string }>;
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0]?.sessionId, "s-override");
    } finally {
      await rm(configuredStateDir, { recursive: true, force: true });
      await rm(overrideStateDir, { recursive: true, force: true });
    }
  });
});

test("sessionsCommand show includes telemetry and artifact details", async () => {
  await withTempHome(async (homeDir) => {
    const configuredStateDir = await mkdtemp(path.join(os.tmpdir(), "mh-cli-sessions-show-"));
    try {
      const configDir = path.join(homeDir, ".microharness");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(configDir, "config.json"),
        JSON.stringify({ stateDir: configuredStateDir }),
        "utf8",
      );

      const store = new SessionStore(configuredStateDir);
      await store.initSession({ sessionId: "s-show", goal: "show details" });
      await store.savePlan("s-show", "# Plan\n\n- one\n");

      const output = await withCapturedStdout(async () => {
        await sessionsCommand({ sub: "show", sessionId: "s-show" });
      });

      const parsed = JSON.parse(output) as {
        manifest?: { sessionId?: string };
        artifacts?: { plan?: { exists?: boolean } };
      };
      assert.equal(parsed.manifest?.sessionId, "s-show");
      assert.equal(parsed.artifacts?.plan?.exists, true);
    } finally {
      await rm(configuredStateDir, { recursive: true, force: true });
    }
  });
});
