import path from "node:path";
import { pathToFileURL } from "node:url";
import { HarnessPlugin } from "../types";

interface PluginFileShape {
  default?: unknown;
  plugin?: unknown;
}

export interface PluginLoaderConfig {
  plugins: string[];
}

export class PluginLoader {
  private readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  async load(config: PluginLoaderConfig): Promise<HarnessPlugin[]> {
    const loaded: HarnessPlugin[] = [];
    for (const pluginRef of config.plugins) {
      const pluginPath = path.isAbsolute(pluginRef) ? pluginRef : path.resolve(this.cwd, pluginRef);
      const plugin = await loadOnePlugin(pluginPath);
      loaded.push(plugin);
    }
    return loaded;
  }
}

async function loadOnePlugin(pluginPath: string): Promise<HarnessPlugin> {
  const fileUrl = pathToFileURL(pluginPath).href;
  const imported = (await import(fileUrl)) as PluginFileShape;
  const candidate = (imported.default ?? imported.plugin) as unknown;

  if (!isHarnessPlugin(candidate)) {
    throw new Error(`Invalid plugin at "${pluginPath}"`);
  }
  return candidate;
}

function isHarnessPlugin(value: unknown): value is HarnessPlugin {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<HarnessPlugin>;
  return typeof candidate.name === "string" && typeof candidate.register === "function";
}
