import assert from "node:assert/strict";
import test from "node:test";
import { CredentialsRegistry } from "../providers/credentialsRegistry";
import { ProviderRegistry } from "../providers/registry";
import type { CredentialsResolver, ProviderAdapter } from "../providers/types";
import type { SubagentSupervisor } from "../subagents/types";
import { ToolRegistry } from "../tools/registry";
import type { ToolDefinition } from "../tools/types";
import { createCoreDefaultTools, registerCoreDefaults } from "./index";

test("registerCoreDefaults registers built-in providers by default", () => {
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const tools = new ToolRegistry();

  registerCoreDefaults({
    providerRegistry: providers,
    credentialsRegistry: credentials,
    toolRegistry: tools,
  });

  assert.equal(providers.has("openai"), true);
  assert.equal(providers.has("anthropic"), true);
  assert.equal(providers.has("ollama"), true);
  assert.equal(credentials.has("openai"), true);
  assert.equal(credentials.has("anthropic"), true);
  assert.equal(credentials.has("ollama"), true);
});

test("registerCoreDefaults only registers explicitly provided tools", () => {
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const tools = new ToolRegistry();
  const customTool: ToolDefinition = {
    name: "custom_echo",
    description: "Return input text",
    risk: "low",
    async execute(input) {
      return { echoed: input.text ?? "" };
    },
  };

  registerCoreDefaults({
    providerRegistry: providers,
    credentialsRegistry: credentials,
    toolRegistry: tools,
    includeBuiltInProviders: false,
    tools: [customTool],
  });

  assert.equal(providers.has("openai"), false);
  assert.equal(tools.has("custom_echo"), true);
  assert.equal(tools.has("fs_read"), false);
});

test("registerCoreDefaults accepts custom providers", () => {
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const tools = new ToolRegistry();

  const adapter: ProviderAdapter = {
    providerId: "acme",
    defaultModel: "acme-mini",
    async complete() {
      return {
        assistantMessage: "ok",
        toolCalls: [],
        stop: true,
      };
    },
  };
  const resolver: CredentialsResolver = {
    async resolve() {
      return { apiKey: "acme-token" };
    },
  };

  registerCoreDefaults({
    providerRegistry: providers,
    credentialsRegistry: credentials,
    toolRegistry: tools,
    includeBuiltInProviders: false,
    providers: [{ adapter, credentials: resolver }],
  });

  assert.equal(providers.has("acme"), true);
  assert.equal(credentials.has("acme"), true);
});

test("createCoreDefaultTools composes optional bundles", () => {
  const tools = createCoreDefaultTools({
    workspaceTools: { rootDir: process.cwd() },
  });
  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names, ["fs_list", "fs_read", "grep_search"]);
});

test("createCoreDefaultTools registers wait tool for subagent supervisors", () => {
  const supervisor: SubagentSupervisor = {
    async run() {
      throw new Error("not used");
    },
    async spawn() {
      return { id: "s1", launchIndex: 1, status: "running" };
    },
    async wait() {
      return { completed: [], running: [] };
    },
    list() {
      return [];
    },
  };

  const tools = createCoreDefaultTools({ subagents: supervisor });

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["spawn_subagent", "wait_subagents"],
  );
});

test("registerCoreDefaults registers native loop hooks in declaration order", () => {
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const tools = new ToolRegistry();
  const before: unknown[] = [];
  const after: unknown[] = [];
  const beforeHooks = [() => {}, () => {}];
  const afterHooks = [() => {}];

  registerCoreDefaults({
    providerRegistry: providers,
    credentialsRegistry: credentials,
    toolRegistry: tools,
    includeBuiltInProviders: false,
    hookRegistrar: {
      onBeforeLoop(hook) {
        before.push(hook);
      },
      onAfterLoop(hook) {
        after.push(hook);
      },
    },
    beforeHooks,
    afterHooks,
  });

  assert.deepEqual(before, beforeHooks);
  assert.deepEqual(after, afterHooks);
});

test("registerCoreDefaults throws when hooks are provided without hookRegistrar", () => {
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const tools = new ToolRegistry();

  assert.throws(
    () =>
      registerCoreDefaults({
        providerRegistry: providers,
        credentialsRegistry: credentials,
        toolRegistry: tools,
        includeBuiltInProviders: false,
        beforeHooks: [() => {}],
      }),
    /hookRegistrar/,
  );
});
