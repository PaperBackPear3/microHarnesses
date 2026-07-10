import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCliConfig } from "./config.js";

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "mh-cli-config-"));
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

test("loadCliConfig prefers env snapshotEvery over file config", async () => {
  await withTempHome(async (homeDir) => {
    const configDir = path.join(homeDir, ".microharness");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify({ snapshotEvery: 3 }),
      "utf8",
    );

    const previous = process.env.MH_SNAPSHOT_EVERY;
    process.env.MH_SNAPSHOT_EVERY = "8";
    try {
      const config = await loadCliConfig({});
      assert.equal(config.snapshotEvery, 8);
    } finally {
      if (previous === undefined) {
        delete process.env.MH_SNAPSHOT_EVERY;
      } else {
        process.env.MH_SNAPSHOT_EVERY = previous;
      }
    }
  });
});

test("loadCliConfig keeps override snapshotEvery above env and file", async () => {
  await withTempHome(async (homeDir) => {
    const configDir = path.join(homeDir, ".microharness");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify({ snapshotEvery: 3 }),
      "utf8",
    );

    const previous = process.env.MH_SNAPSHOT_EVERY;
    process.env.MH_SNAPSHOT_EVERY = "8";
    try {
      const config = await loadCliConfig({ snapshotEvery: 11 });
      assert.equal(config.snapshotEvery, 11);
    } finally {
      if (previous === undefined) {
        delete process.env.MH_SNAPSHOT_EVERY;
      } else {
        process.env.MH_SNAPSHOT_EVERY = previous;
      }
    }
  });
});

test("loadCliConfig resolves state-machine settings from env and overrides", async () => {
  await withTempHome(async () => {
    const previousMode = process.env.MH_STATE_MACHINE;
    const previousProfile = process.env.MH_STATE_MACHINE_PROFILE;
    process.env.MH_STATE_MACHINE = "advisory";
    process.env.MH_STATE_MACHINE_PROFILE = "focused-delivery";
    try {
      const fromEnv = await loadCliConfig({});
      assert.equal(fromEnv.stateMachineEnforcement, "advisory");
      assert.equal(fromEnv.stateMachineProfile, "focused-delivery");

      const fromOverride = await loadCliConfig({ stateMachineEnforcement: "strict" });
      assert.equal(fromOverride.stateMachineEnforcement, "strict");
      assert.equal(fromOverride.stateMachineProfile, "focused-delivery");
    } finally {
      if (previousMode === undefined) {
        delete process.env.MH_STATE_MACHINE;
      } else {
        process.env.MH_STATE_MACHINE = previousMode;
      }
      if (previousProfile === undefined) {
        delete process.env.MH_STATE_MACHINE_PROFILE;
      } else {
        process.env.MH_STATE_MACHINE_PROFILE = previousProfile;
      }
    }
  });
});
