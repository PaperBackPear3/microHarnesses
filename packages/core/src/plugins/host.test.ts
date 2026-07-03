import assert from "node:assert/strict";
import test from "node:test";
import { CompositePolicyEngine } from "../policy/compositePolicyEngine";
import { DefaultPolicyEngine } from "../policy/defaultPolicyEngine";
import { CredentialsRegistry } from "../providers/credentialsRegistry";
import { ProviderRegistry } from "../providers/registry";
import { PluginCapabilityError, PluginLoadError } from "../shared/errors";
import { ToolRegistry } from "../tools/registry";
import { PluginHost } from "./host";
import type { HarnessPlugin, PluginApi } from "./types";

function buildHost() {
  const tools = new ToolRegistry();
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const policy = new CompositePolicyEngine(new DefaultPolicyEngine());
  const beforeHooks: unknown[] = [];
  const afterHooks: unknown[] = [];
  return {
    tools,
    providers,
    credentials,
    policy,
    beforeHooks,
    afterHooks,
    host: new PluginHost({
      tools,
      providers,
      credentials,
      policy,
      onBeforeLoop: (hook) => beforeHooks.push(hook),
      onAfterLoop: (hook) => afterHooks.push(hook),
      setCompressor: () => {},
      setModelSelector: () => {},
    }),
  };
}

test("plugin registers a tool when it declares the tools capability", async () => {
  const { host, tools } = buildHost();
  const plugin: HarnessPlugin = {
    name: "p",
    capabilities: ["tools"],
    register(api: PluginApi) {
      api.registerTool({
        name: "t",
        description: "",
        risk: "low",
        async execute() {
          return {};
        },
      });
    },
  };
  await host.register([plugin]);
  assert.equal(tools.has("t"), true);
  assert.deepEqual([...host.plugins().keys()], ["p"]);
});

test("host throws when plugin uses a capability it did not declare", async () => {
  const { host } = buildHost();
  const plugin: HarnessPlugin = {
    name: "p",
    capabilities: ["tools"],
    register(api: PluginApi) {
      api.registerPolicyRule(() => undefined);
    },
  };
  await assert.rejects(() => host.register([plugin]), PluginCapabilityError);
});

test("host throws PluginLoadError when a plugin lacks capabilities array", async () => {
  const { host } = buildHost();
  const plugin = {
    name: "bad",
    register() {},
  } as unknown as HarnessPlugin;
  await assert.rejects(() => host.register([plugin]), PluginLoadError);
});

test("host rejects duplicate plugin names", async () => {
  const { host } = buildHost();
  const plugin: HarnessPlugin = {
    name: "dup",
    capabilities: [],
    register() {},
  };
  await host.register([plugin]);
  await assert.rejects(() => host.register([plugin]), PluginLoadError);
});

test("hooks capability enables onBeforeLoop / onAfterLoop", async () => {
  const { host, beforeHooks, afterHooks } = buildHost();
  const plugin: HarnessPlugin = {
    name: "hooks",
    capabilities: ["hooks"],
    register(api: PluginApi) {
      api.onBeforeLoop(async () => {});
      api.onAfterLoop(async () => {});
    },
  };
  await host.register([plugin]);
  assert.equal(beforeHooks.length, 1);
  assert.equal(afterHooks.length, 1);
});
