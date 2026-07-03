import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PluginApi, ToolDefinition } from "@micro-harness/core";
import { ExplorerPlugin } from "./agents/explorerPlugin";
import { PlannerPlugin } from "./agents/plannerPlugin";
import { PlanModePlugin } from "./planModePlugin";

function makeApi(tools: Map<string, ToolDefinition>): PluginApi {
  return {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    onBeforeLoop() {},
    onAfterLoop() {},
    setCompressor() {},
    registerProvider() {},
    registerCredentialsResolver() {},
    registerPolicyRule() {},
    setModelSelector() {},
    subagents: {
      async run() {
        throw new Error("subagents not available in tests");
      },
    },
  };
}

// ── Composite plugin ────────────────────────────────────────────────────────

test("PlanModePlugin registers all three tools", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-plan-plugin-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src", "index.ts"),
    "export const value = 1;\n// planner query match\n",
    "utf8",
  );

  try {
    const tools = new Map<string, ToolDefinition>();
    new PlanModePlugin({ rootDir: root }).register(makeApi(tools));

    assert.ok(tools.has("plan_agent"), "plan_agent must be registered");
    assert.ok(tools.has("explore_agent"), "explore_agent must be registered");
    assert.ok(tools.has("plan_mode_info"), "plan_mode_info must be registered");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ── PlannerPlugin ────────────────────────────────────────────────────────────

test("PlannerPlugin produces correct step count and read_only flag", async () => {
  const tools = new Map<string, ToolDefinition>();
  new PlannerPlugin().register(makeApi(tools));
  const planTool = tools.get("plan_agent")!;

  const result = (await planTool.execute({ goal: "Ship planning plugin", max_steps: 10 })) as {
    read_only: boolean;
    actual_steps: number;
    requested_max_steps: number;
    steps: unknown[];
  };
  assert.equal(result.read_only, true);
  assert.equal(result.requested_max_steps, 10);
  assert.equal(result.actual_steps, 10);
  assert.equal(result.steps.length, 10);
});

test("PlannerPlugin clamps max_steps to template count (12)", async () => {
  const tools = new Map<string, ToolDefinition>();
  new PlannerPlugin().register(makeApi(tools));

  const result = (await tools.get("plan_agent")!.execute({ goal: "test", max_steps: 99 })) as {
    actual_steps: number;
    requested_max_steps: number;
  };
  assert.equal(result.requested_max_steps, 12, "max_steps clamped to 12");
  assert.equal(result.actual_steps, 12);
});

test("PlannerPlugin rejects empty goal", async () => {
  const tools = new Map<string, ToolDefinition>();
  new PlannerPlugin().register(makeApi(tools));
  await assert.rejects(() => tools.get("plan_agent")!.execute({ goal: "" }));
});

test("PlannerPlugin declares goal as required in input schema", () => {
  const tools = new Map<string, ToolDefinition>();
  new PlannerPlugin().register(makeApi(tools));
  const schema = tools.get("plan_agent")!.inputSchema as {
    required?: string[];
    additionalProperties?: boolean;
  };
  assert.deepEqual(schema.required, ["goal"]);
  assert.equal(schema.additionalProperties, false);
});

// ── ExplorerPlugin ────────────────────────────────────────────────────────────

test("ExplorerPlugin finds matching files and returns relative root_path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-explore-plugin-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "// explore-test-marker\n", "utf8");

  try {
    const tools = new Map<string, ToolDefinition>();
    new ExplorerPlugin({ rootDir: root }).register(makeApi(tools));

    const result = (await tools
      .get("explore_agent")!
      .execute({ query: "explore-test-marker", max_files: 5 })) as {
      read_only: boolean;
      total_results: number;
      root_path: string;
    };
    assert.equal(result.read_only, true);
    assert.equal(result.total_results > 0, true);
    assert.equal(result.root_path, ".");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ExplorerPlugin blocks path traversal", async () => {
  const tools = new Map<string, ToolDefinition>();
  new ExplorerPlugin({ rootDir: process.cwd() }).register(makeApi(tools));
  await assert.rejects(() =>
    tools.get("explore_agent")!.execute({ query: "x", root_path: "../../" }),
  );
});

test("ExplorerPlugin accepts root_directory alias for root_path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-explore-plugin-alias-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "const marker = 'root-directory-alias';\n", "utf8");

  try {
    const tools = new Map<string, ToolDefinition>();
    new ExplorerPlugin({ rootDir: root }).register(makeApi(tools));
    const result = (await tools.get("explore_agent")!.execute({
      query: "root-directory-alias",
      root_directory: "src",
      max_files: 5,
    })) as { total_results: number; root_path: string };
    assert.equal(result.total_results > 0, true);
    assert.equal(result.root_path, "src");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ExplorerPlugin declares query as required in input schema", () => {
  const tools = new Map<string, ToolDefinition>();
  new ExplorerPlugin({ rootDir: process.cwd() }).register(makeApi(tools));
  const schema = tools.get("explore_agent")!.inputSchema as {
    required?: string[];
    additionalProperties?: boolean;
  };
  assert.deepEqual(schema.required, ["query"]);
  assert.equal(schema.additionalProperties, false);
});

// ── plan_mode_info ────────────────────────────────────────────────────────────

test("plan_mode_info lists itself and the other two tools", async () => {
  const tools = new Map<string, ToolDefinition>();
  new PlanModePlugin().register(makeApi(tools));
  const infoResult = (await tools.get("plan_mode_info")!.execute({})) as { tools: string[] };
  assert.ok(infoResult.tools.includes("plan_mode_info"), "plan_mode_info must list itself");
  assert.ok(infoResult.tools.includes("plan_agent"));
  assert.ok(infoResult.tools.includes("explore_agent"));
});
