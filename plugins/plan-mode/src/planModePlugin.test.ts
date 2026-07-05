import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PluginApi, ToolDefinition } from "@micro-harnesses/core";
import { ExplorerPlugin } from "./agents/explorerPlugin";
import { PlannerPlugin } from "./agents/plannerPlugin";
import { PlanModePlugin } from "./planModePlugin";

function makeApi(tools: Map<string, ToolDefinition>): PluginApi {
  return {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerChannel() {},
    registerSkill() {},
    onBeforeLoop() {},
    onAfterLoop() {},
    setCompressor() {},
    registerProvider() {},
    registerCredentialsResolver() {},
    registerPolicyRule() {},
    setModelSelector() {},
    agents: {
      async spawn() {
        throw new Error("agents not available in tests");
      },
      async invoke() {
        throw new Error("agents not available in tests");
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
  await writeFile(
    path.join(root, "src", "index.ts"),
    "const marker = 'root-directory-alias';\n",
    "utf8",
  );

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

test("ExplorerPlugin matches filenames when content has no query hit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-explore-plugin-filename-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "cli-summary.ts"), "export const value = 1;\n", "utf8");

  try {
    const tools = new Map<string, ToolDefinition>();
    new ExplorerPlugin({ rootDir: root }).register(makeApi(tools));
    const result = (await tools.get("explore_agent")!.execute({
      query: "summary",
      root_path: "src",
      max_files: 5,
    })) as {
      total_results: number;
      fallback: string;
      results: Array<{ file: string }>;
    };
    assert.equal(result.total_results > 0, true);
    assert.equal(result.fallback, "match");
    assert.equal(
      result.results.some((entry) => entry.file === "src/cli-summary.ts"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ExplorerPlugin returns inventory fallback when query has no matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-explore-plugin-fallback-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "export const answer = 42;\n", "utf8");

  try {
    const tools = new Map<string, ToolDefinition>();
    new ExplorerPlugin({ rootDir: root }).register(makeApi(tools));
    const result = (await tools.get("explore_agent")!.execute({
      query: "no-such-token-anywhere",
      root_path: "src",
      max_files: 5,
    })) as {
      total_results: number;
      fallback: string;
      results: Array<{ file: string; matches: Array<{ line: number; snippet: string }> }>;
    };
    assert.equal(result.total_results > 0, true);
    assert.equal(result.fallback, "inventory");
    assert.equal(result.results[0]?.file, "src/index.ts");
    assert.equal(result.results[0]?.matches[0]?.line, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ExplorerPlugin accepts a single file path as root_path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-explore-plugin-single-file-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src", "single.ts"),
    "export const singleFileMarker = true;\n",
    "utf8",
  );

  try {
    const tools = new Map<string, ToolDefinition>();
    new ExplorerPlugin({ rootDir: root }).register(makeApi(tools));
    const result = (await tools.get("explore_agent")!.execute({
      query: "singleFileMarker",
      root_path: "src/single.ts",
      max_files: 5,
    })) as {
      total_results: number;
      fallback: string;
      results: Array<{ file: string }>;
    };
    assert.equal(result.total_results, 1);
    assert.equal(result.fallback, "match");
    assert.equal(result.results[0]?.file, "src/single.ts");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ExplorerPlugin can explore without query using inventory fallback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-explore-plugin-no-query-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "export const noQuery = true;\n", "utf8");

  try {
    const tools = new Map<string, ToolDefinition>();
    new ExplorerPlugin({ rootDir: root }).register(makeApi(tools));
    const result = (await tools.get("explore_agent")!.execute({
      root_path: "src",
      max_files: 5,
    })) as {
      fallback: string;
      report: { query_provided: boolean };
      total_results: number;
    };
    assert.equal(result.fallback, "inventory");
    assert.equal(result.report.query_provided, false);
    assert.equal(result.total_results > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ExplorerPlugin supports mixed file and directory targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mh-explore-plugin-mixed-targets-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src", "alpha.ts"),
    "export const alpha = 'mixed-target';\n",
    "utf8",
  );
  await writeFile(path.join(root, "single.ts"), "export const single = 'mixed-target';\n", "utf8");

  try {
    const tools = new Map<string, ToolDefinition>();
    new ExplorerPlugin({ rootDir: root }).register(makeApi(tools));
    const result = (await tools.get("explore_agent")!.execute({
      query: "mixed-target",
      targets: ["src", "single.ts"],
      max_files: 6,
    })) as {
      total_results: number;
      targets: string[];
      report: { explored_targets: Array<{ requested: string; kind: "file" | "directory" }> };
      results: Array<{ file: string }>;
    };
    assert.equal(result.total_results >= 2, true);
    assert.deepEqual(result.targets, ["src", "single.ts"]);
    assert.equal(
      result.report.explored_targets.some((target) => target.requested === "src"),
      true,
    );
    assert.equal(
      result.report.explored_targets.some(
        (target) => target.requested === "single.ts" && target.kind === "file",
      ),
      true,
    );
    assert.equal(
      result.results.some((entry) => entry.file === "src/alpha.ts"),
      true,
    );
    assert.equal(
      result.results.some((entry) => entry.file === "single.ts"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ExplorerPlugin does not require query in input schema", () => {
  const tools = new Map<string, ToolDefinition>();
  new ExplorerPlugin({ rootDir: process.cwd() }).register(makeApi(tools));
  const schema = tools.get("explore_agent")!.inputSchema as {
    required?: string[];
    additionalProperties?: boolean;
  };
  assert.equal(Array.isArray(schema.required), false);
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
