import type { HarnessPlugin, PluginApi, PluginCapability } from "@micro-harness/core";
import { echoTool, timeTool } from "./tools";

const CAPABILITIES: PluginCapability[] = ["tools"];

/**
 * Reference plugin: registers `echo` and `time` tools. Use this as a template
 * for authoring your own tool plugins.
 */
export class ExampleToolsPlugin implements HarnessPlugin {
  readonly name = "example-tools-plugin";
  readonly capabilities = CAPABILITIES;

  register(api: PluginApi): void {
    api.registerTool(echoTool);
    api.registerTool(timeTool);
  }
}

export const exampleToolsPlugin: HarnessPlugin = new ExampleToolsPlugin();
