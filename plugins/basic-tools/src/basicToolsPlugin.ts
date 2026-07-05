import type { HarnessPlugin, PluginApi, PluginCapability } from "@micro-harnesses/core";
import { type BasicToolsPluginOptions, resolveOptions } from "./options";
import { createFilesystemTools } from "./tools/filesystemTools";
import { createShellTool } from "./tools/shellTool";

const CAPABILITIES: PluginCapability[] = ["tools"];

export class BasicToolsPlugin implements HarnessPlugin {
  readonly name = "basic-tools-plugin";
  readonly capabilities = CAPABILITIES;
  private readonly options: ReturnType<typeof resolveOptions>;

  constructor(options: BasicToolsPluginOptions = {}) {
    this.options = resolveOptions(options);
  }

  register(api: PluginApi): void {
    for (const tool of createFilesystemTools(this.options)) {
      api.registerTool(tool);
    }
    api.registerTool(createShellTool(this.options));
  }
}

export const basicToolsPlugin: HarnessPlugin = new BasicToolsPlugin();
