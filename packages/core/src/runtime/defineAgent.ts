import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ContextManager } from "../context/manager";
import { registerBuiltInProviders } from "../defaults/providers/plugins";
import {
  createSpawnSubagentTool,
  createWaitSubagentsTool,
} from "../defaults/tools/spawnSubagentTool";
import { createMcpToolset } from "../mcp/asTools";
import type { McpServerConfig } from "../mcp/types";
import { DefaultModelSelector } from "../model/defaultModelSelector";
import { ProviderModelAdapter } from "../model/providerModelAdapter";
import type { ModelAdapter, ModelProfile, ModelSelector } from "../model/types";
import type { ObservabilityProvider } from "../observability/types";
import { CompositePolicyEngine } from "../policy/compositePolicyEngine";
import { DefaultPolicyEngine } from "../policy/defaultPolicyEngine";
import type { PolicyRule, ToolPolicyEngine } from "../policy/types";
import type { PromptBundle, PromptMetadata, PromptSource } from "../prompts/types";
import { CredentialsRegistry } from "../providers/credentialsRegistry";
import { ProviderRegistry } from "../providers/registry";
import type { SessionStore } from "../session/sessionStore";
import { ValidationError } from "../shared/errors";
import { SkillRegistry } from "../skills/registry";
import type { SkillDefinition } from "../skills/types";
import { InProcessSubagentSupervisor } from "../subagents/supervisor";
import type { SubagentRuntimeFactory, SubagentSupervisor } from "../subagents/types";
import { ToolRegistry } from "../tools/registry";
import type { ToolDefinition } from "../tools/types";
import { Agent, type AgentOptions } from "./agent";
import type { ApprovalHandler, RuntimeLimits } from "./types";

export interface PromptFileInput {
  path: string;
  strictVariables?: boolean;
  variables?: Record<string, string>;
}

export type PromptInput = string | PromptFileInput;

export interface DefineAgentSubagentMap {
  [name: string]: Agent | DefineAgentOptions;
}

export interface StaticModelConfig {
  providerId: string;
  model?: string;
  maxTokens?: number;
  profile?: ModelProfile;
}

export interface DefineAgentOptions {
  name: string;
  role?: string;
  prompt?: PromptInput;
  model: ModelAdapter | StaticModelConfig;
  tools?: ToolDefinition[] | ToolRegistry;
  skills?: SkillDefinition[] | SkillRegistry;
  prompts?: PromptSource;
  context?: ContextManager;
  policy?: ToolPolicyEngine | PolicyRule[];
  modelSelector?: ModelSelector;
  observability?: ObservabilityProvider;
  sessionStore?: SessionStore;
  limits?: RuntimeLimits;
  approvalHandler?: ApprovalHandler;
  kind?: "main" | "subagent";
  stateDir?: string;
  maxWorkingTurns?: number;
  includeBuiltInProviders?: boolean;
  providerRegistry?: ProviderRegistry;
  credentialsRegistry?: CredentialsRegistry;
  subagents?: DefineAgentSubagentMap;
  mcp?: McpServerConfig[];
}

export function promptFromFile(filePath: string, options: Omit<PromptFileInput, "path"> = {}) {
  return {
    path: filePath,
    strictVariables: options.strictVariables,
    variables: options.variables,
  } satisfies PromptFileInput;
}

export function defineAgent(options: DefineAgentOptions): Agent {
  if (options.mcp && options.mcp.length > 0) {
    throw new ValidationError("defineAgent with mcp servers requires defineAgentAsync()");
  }
  const tools = resolveTools(options.tools);

  const skills = resolveSkills(options.skills);

  const policy = resolvePolicy(options.policy);
  const context =
    options.context ??
    new ContextManager({
      stateDir: path.resolve(
        options.stateDir ?? path.join(process.cwd(), ".micro-harness", options.name),
      ),
      maxWorkingTurns: options.maxWorkingTurns ?? 16,
      goal: "",
    });
  const prompts =
    options.prompts ?? new InlinePromptSource(options.name, options.prompt ?? "", options.role);
  const modelSelector = options.modelSelector ?? new DefaultModelSelector();
  const model = resolveModelAdapter(options);

  const agent = new Agent({
    promptName: options.name,
    model,
    modelSelector,
    prompts,
    tools,
    skills,
    context,
    policy,
    observability: options.observability,
    sessionStore: options.sessionStore,
    limits: options.limits,
    approvalHandler: options.approvalHandler,
    kind: options.kind,
  });

  if (options.subagents && Object.keys(options.subagents).length > 0) {
    const supervisor = createDeclarativeSubagents(agent, options.subagents);
    tools.register(createSpawnSubagentTool(supervisor));
    tools.register(createWaitSubagentsTool(supervisor));
  }

  return agent;
}

export async function defineAgentAsync(options: DefineAgentOptions): Promise<Agent> {
  const mcp = options.mcp ?? [];
  if (mcp.length === 0) {
    return defineAgent(options);
  }
  const toolsets = await Promise.all(mcp.map((server) => createMcpToolset(server)));
  const configuredTools =
    options.tools instanceof ToolRegistry ? options.tools.list() : (options.tools ?? []);
  const agent = defineAgent({
    ...options,
    mcp: undefined,
    tools: [...configuredTools, ...toolsets.flatMap((toolset) => toolset.tools)],
  });
  return agent;
}

function resolveModelAdapter(options: DefineAgentOptions): ModelAdapter {
  if ("nextStep" in options.model) {
    return options.model;
  }
  const providerRegistry = options.providerRegistry ?? new ProviderRegistry();
  const credentialsRegistry = options.credentialsRegistry ?? new CredentialsRegistry();
  if (options.includeBuiltInProviders !== false) {
    registerBuiltInProviders(providerRegistry, credentialsRegistry);
  }
  return new ProviderModelAdapter({
    providerRegistry,
    credentialsRegistry,
    providerId: options.model.providerId,
    model: options.model.model,
    maxTokens: options.model.maxTokens,
  });
}

function resolveTools(tools: DefineAgentOptions["tools"]): ToolRegistry {
  if (tools instanceof ToolRegistry) {
    return tools;
  }
  const registry = new ToolRegistry();
  for (const tool of tools ?? []) {
    registry.register(tool);
  }
  return registry;
}

function resolveSkills(skills: DefineAgentOptions["skills"]): SkillRegistry | undefined {
  if (skills instanceof SkillRegistry) {
    return skills;
  }
  if (!skills || skills.length === 0) {
    return undefined;
  }
  const registry = new SkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
  return registry;
}

function resolvePolicy(policy: DefineAgentOptions["policy"]): ToolPolicyEngine {
  if (!policy) {
    return new DefaultPolicyEngine();
  }
  if ("evaluate" in policy) {
    return policy;
  }
  const composite = new CompositePolicyEngine(new DefaultPolicyEngine());
  for (const rule of policy) {
    composite.addRule(rule);
  }
  return composite;
}

function createDeclarativeSubagents(
  agent: Agent,
  definitions: DefineAgentSubagentMap,
): SubagentSupervisor {
  const defaultSubagentName = Object.keys(definitions)[0];

  const factory: SubagentRuntimeFactory = {
    async build(request, parent) {
      const selectedName = request.promptName ?? defaultSubagentName;
      if (!selectedName) {
        throw new ValidationError("No subagent definitions are configured");
      }
      const definition = definitions[selectedName];
      if (!definition) {
        throw new ValidationError(`Unknown subagent "${selectedName}"`);
      }
      const child = resolveSubagent(selectedName, definition);
      return {
        agent: child,
        prompt: request.prompt,
        runOptions: {
          maxIterations: request.maxIterations ?? 8,
          snapshotEvery: 1,
          profile: defaultProfileFor(child.promptName),
          sessionId: `s-${randomUUID()}`,
          goal: request.goal ?? request.prompt,
          displayName: request.name ?? selectedName,
          parentSessionId: parent.sessionId,
          rootSessionId: parent.sessionId,
          parentTrace: request.parentTrace,
          depth: 1,
        },
      };
    },
  };
  return new InProcessSubagentSupervisor(factory, agent);
}

function resolveSubagent(name: string, definition: Agent | DefineAgentOptions): Agent {
  if (definition instanceof Agent) {
    return definition;
  }
  return defineAgent({
    ...definition,
    kind: "subagent",
  });
}

function defaultProfileFor(name: string): ModelProfile {
  return { defaultModel: `agent:${name}` };
}

class InlinePromptSource implements PromptSource {
  private readonly promptName: string;
  private readonly prompt: PromptInput;
  private readonly role?: string;

  constructor(promptName: string, prompt: PromptInput, role?: string) {
    this.promptName = promptName;
    this.prompt = prompt;
    this.role = role;
  }

  async load(_promptName: string, task: string): Promise<PromptBundle> {
    const resolved = await resolvePrompt(this.prompt);
    const role = this.role ?? resolved.role;
    const system = role ? `Role: ${role}\n\n${resolved.system}` : resolved.system;
    return {
      system,
      instructions: [],
      task,
      metadata: {
        ...resolved.metadata,
        name: this.promptName,
      },
    };
  }
}

async function resolvePrompt(prompt: PromptInput): Promise<{
  system: string;
  metadata: PromptMetadata;
  role?: string;
}> {
  if (typeof prompt === "string") {
    return {
      system: prompt,
      metadata: { name: "inline" },
    };
  }
  const raw = await readFile(path.resolve(prompt.path), "utf8");
  const parsed = parseFrontmatter(raw);
  const metadata: PromptMetadata = {
    name: "file",
    ...(typeof parsed.attributes.modelHint === "string"
      ? { modelHint: parsed.attributes.modelHint }
      : {}),
    ...(parsed.attributes.taskTypeHint === "default" ||
    parsed.attributes.taskTypeHint === "reasoning" ||
    parsed.attributes.taskTypeHint === "fast"
      ? { taskTypeHint: parsed.attributes.taskTypeHint }
      : {}),
    ...(parsed.attributes.safetyMode === "strict" ||
    parsed.attributes.safetyMode === "balanced" ||
    parsed.attributes.safetyMode === "open"
      ? { safetyMode: parsed.attributes.safetyMode }
      : {}),
  };
  return {
    system: renderTemplate(parsed.body, prompt.variables ?? {}, prompt.strictVariables ?? false),
    metadata,
    ...(typeof parsed.attributes.role === "string" ? { role: parsed.attributes.role } : {}),
  };
}

function parseFrontmatter(markdown: string): {
  attributes: Record<string, string>;
  body: string;
} {
  if (!markdown.startsWith("---\n")) {
    return { attributes: {}, body: markdown };
  }
  const endIndex = markdown.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { attributes: {}, body: markdown };
  }
  const frontmatter = markdown.slice(4, endIndex);
  const attributes: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || !value) continue;
    attributes[key] = value;
  }
  return {
    attributes,
    body: markdown.slice(endIndex + 5),
  };
}

function renderTemplate(
  text: string,
  variables: Record<string, string>,
  strictVariables: boolean,
): string {
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return variables[key] as string;
    }
    if (strictVariables) {
      throw new Error(`Missing template variable: ${key}`);
    }
    return "";
  });
}
