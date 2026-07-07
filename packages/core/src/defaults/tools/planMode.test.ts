import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPlanModeTools } from "./planMode";

test("createPlanModeTools registers planner, explorer, and info tools", () => {
  const tools = createPlanModeTools({ rootDir: process.cwd() });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["plan_agent", "explore_agent", "plan_mode_info"],
  );
});

test("plan_agent enforces goal and clamps max_steps", async () => {
  const planTool = createPlanModeTools({ rootDir: process.cwd() }).find(
    (tool) => tool.name === "plan_agent",
  );
  assert.ok(planTool);

  await assert.rejects(() => planTool.execute({ goal: "" }));

  const result = (await planTool.execute({ goal: "Ship feature", max_steps: 99 })) as {
    read_only: boolean;
    requested_max_steps: number;
    actual_steps: number;
  };
  assert.equal(result.read_only, true);
  assert.equal(result.requested_max_steps, 12);
  assert.equal(result.actual_steps, 12);
});

test("explore_agent supports query matches and inventory fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-core-plan-tools-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "const marker = 'found-me';\n", "utf8");

  try {
    const exploreTool = createPlanModeTools({ rootDir: root }).find(
      (tool) => tool.name === "explore_agent",
    );
    assert.ok(exploreTool);

    const matchResult = (await exploreTool.execute({ query: "found-me", root_path: "src" })) as {
      read_only: boolean;
      fallback: string;
      total_results: number;
    };
    assert.equal(matchResult.read_only, true);
    assert.equal(matchResult.fallback, "match");
    assert.equal(matchResult.total_results > 0, true);

    const inventoryResult = (await exploreTool.execute({
      query: "missing-token",
      root_path: "src",
    })) as { fallback: string; total_results: number };
    assert.equal(inventoryResult.fallback, "inventory");
    assert.equal(inventoryResult.total_results > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explore_agent blocks path traversal", async () => {
  const exploreTool = createPlanModeTools({ rootDir: process.cwd() }).find(
    (tool) => tool.name === "explore_agent",
  );
  assert.ok(exploreTool);
  await assert.rejects(() => exploreTool.execute({ root_path: "../../" }));
});

test("plan_mode_info reports safety guarantees", async () => {
  const infoTool = createPlanModeTools({ rootDir: process.cwd() }).find(
    (tool) => tool.name === "plan_mode_info",
  );
  assert.ok(infoTool);
  const result = (await infoTool.execute({})) as { tools: string[]; guarantees: string[] };
  assert.deepEqual(result.tools, ["plan_agent", "explore_agent", "plan_mode_info"]);
  assert.equal(result.guarantees.includes("No file writes"), true);
});
