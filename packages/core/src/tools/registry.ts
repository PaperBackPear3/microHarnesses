import { DuplicateToolError, UnknownToolError } from "../shared/errors";
import type { ToolCatalogEntry, ToolCatalogQuery, ToolDefinition } from "./types";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new DuplicateToolError(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new UnknownToolError(`Unknown tool: "${name}"`);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  catalog(query: ToolCatalogQuery = {}): ToolCatalogEntry[] {
    return this.list()
      .filter((tool) => {
        if (query.capability && !(tool.capabilities ?? []).includes(query.capability)) {
          return false;
        }
        if (query.tag && !(tool.tags ?? []).includes(query.tag)) {
          return false;
        }
        if (query.owner && tool.governance?.owner !== query.owner) {
          return false;
        }
        return true;
      })
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        risk: tool.risk,
        capabilities: [...(tool.capabilities ?? [])],
        tags: [...(tool.tags ?? [])],
        governance: tool.governance,
      }));
  }
}
