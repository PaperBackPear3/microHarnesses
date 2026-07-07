import type { HarnessPlugin, PluginApi } from "@micro-harnesses/core";
import { echoTool, timeTool } from "./tools";

/**
 * Reference plugin: registers `echo` and `time` tools. Use this as a template
 * for authoring your own tool plugins.
 */
export class ExampleToolsPlugin implements HarnessPlugin {
  readonly name = "example-tools-plugin";
  readonly capabilities = ["tools"];

  register(api: PluginApi): void {
    api.registerTool(echoTool);
    api.registerTool(timeTool);
  }
}

export const exampleToolsPlugin: HarnessPlugin = new ExampleToolsPlugin();
