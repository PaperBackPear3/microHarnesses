import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { ToolDefinition } from "@micro-harness/core";
import { PlanModePlugin } from "./planModePlugin";

test("PlanModePlugin registers read-only plan and explore tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-plan-plugin-"));
  const srcDir = path.join(root, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(path.join(srcDir, "index.ts"), "export const value = 1;\n// planner query match\n", "utf8");

  try {
    const plugin = new PlanModePlugin({ rootDir: root });
    const tools = new Map<string, ToolDefinition>();
    plugin.register({
      registerTool(tool) {
        tools.set(tool.name, tool);
      },
      onBeforeLoop() {},
      onAfterLoop() {},
      setCompressor() {}
    });

    const planTool = tools.get("plan_agent");
    const exploreTool = tools.get("explore_agent");
    const infoTool = tools.get("plan_mode_info");
    assert.ok(planTool);
    assert.ok(exploreTool);
    assert.ok(infoTool);

    const plan = await planTool!.execute({ goal: "Ship planning plugin", max_steps: 10 });
    const planData = plan as { read_only: boolean; actual_steps: number; requested_max_steps: number };
    assert.equal(planData.read_only, true);
    assert.equal(planData.requested_max_steps, 10);
    assert.equal(planData.actual_steps, 10);

    const explore = await exploreTool!.execute({ query: "planner", max_files: 5 });
    const exploreData = explore as { read_only: boolean; total_results: number; root_path: string };
    assert.equal(exploreData.read_only, true);
    assert.equal(exploreData.total_results > 0, true);
    assert.equal(exploreData.root_path, ".");

    const info = await infoTool!.execute({});
    const infoData = info as { tools: string[] };
    assert.equal(infoData.tools.includes("plan_mode_info"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explore agent blocks path traversal", async () => {
  const plugin = new PlanModePlugin({ rootDir: process.cwd() });
  let exploreTool: ToolDefinition | undefined;
  plugin.register({
    registerTool(tool) {
      if (tool.name === "explore_agent") {
        exploreTool = tool;
      }
    },
    onBeforeLoop() {},
    onAfterLoop() {},
    setCompressor() {}
  });
  assert.ok(exploreTool);
  await assert.rejects(() => exploreTool!.execute({ query: "x", root_path: "../../" }));
});
