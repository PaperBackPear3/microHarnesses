import { HarnessPlugin, PluginApi, ToolDefinition } from "@micro-harness/core";
import { PlannerPlugin } from "./agents/plannerPlugin";
import { ExplorerPlugin, ExplorerPluginOptions } from "./agents/explorerPlugin";

export type { ExplorerPluginOptions };

/** Options for the composite PlanModePlugin. All fields relate to ExplorerPlugin. */
export type PlanModePluginOptions = ExplorerPluginOptions;

/**
 * Composite plugin that registers plan_agent, explore_agent, and plan_mode_info.
 * Use PlannerPlugin or ExplorerPlugin directly when you only need one capability.
 */
export class PlanModePlugin implements HarnessPlugin {
  readonly name = "plan-mode-plugin";
  private readonly planner: PlannerPlugin;
  private readonly explorer: ExplorerPlugin;

  constructor(options: PlanModePluginOptions = {}) {
    this.planner = new PlannerPlugin();
    this.explorer = new ExplorerPlugin(options);
  }

  register(api: PluginApi): void {
    this.planner.register(api);
    this.explorer.register(api);
    api.registerTool(this.planModeInfoTool());
  }

  private planModeInfoTool(): ToolDefinition {
    return {
      name: "plan_mode_info",
      description: "Returns capabilities and guarantees of the plan-mode read-only tools.",
      risk: "low",
      async execute() {
        return {
          mode: "plan_mode",
          tools: ["plan_agent", "explore_agent", "plan_mode_info"],
          guarantees: [
            "No file writes",
            "No process execution",
            "No network calls",
            "Planning and exploration only"
          ]
        };
      }
    };
  }
}
