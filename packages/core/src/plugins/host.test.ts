import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryObservabilityExporter } from "../observability/inMemoryExporter";
import { DefaultObservabilityProvider } from "../observability/provider";
import { CompositePolicyEngine } from "../policy/compositePolicyEngine";
import { DefaultPolicyEngine } from "../policy/defaultPolicyEngine";
import { CredentialsRegistry } from "../providers/credentialsRegistry";
import { ProviderRegistry } from "../providers/registry";
import { PluginCapabilityError, PluginLoadError } from "../shared/errors";
import { SkillRegistry } from "../skills/registry";
import { ToolRegistry } from "../tools/registry";
import { ChannelRegistry } from "../channels/registry";
import { PluginHost } from "./host";
import type { HarnessPlugin, PluginApi } from "./types";

function buildHost() {
  const tools = new ToolRegistry();
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const policy = new CompositePolicyEngine(new DefaultPolicyEngine());
  const skills = new SkillRegistry();
  const channels = new ChannelRegistry();
  const beforeHooks: unknown[] = [];
  const afterHooks: unknown[] = [];
  return {
    tools,
    providers,
    credentials,
    policy,
    skills,
    channels,
    beforeHooks,
    afterHooks,
    host: new PluginHost({
      tools,
      providers,
      credentials,
      policy,
      skills,
      onBeforeLoop: (hook) => beforeHooks.push(hook),
      onAfterLoop: (hook) => afterHooks.push(hook),
      setCompressor: () => {},
      setModelSelector: () => {},
      channels,
    }),
  };
}

test("plugin registers a tool", async () => {
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

test("host rejects duplicate plugin names", async () => {
  const { host } = buildHost();
  const plugin: HarnessPlugin = {
    name: "dup",
    capabilities: ["tools"],
    register() {},
  };
  await host.register([plugin]);
  await assert.rejects(() => host.register([plugin]), PluginLoadError);
});

test("hooks registration attaches before/after hooks", async () => {
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

test("registration is atomic when plugin register throws", async () => {
  const { host, tools } = buildHost();
  const plugin: HarnessPlugin = {
    name: "boom",
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
      throw new Error("registration failed");
    },
  };
  await assert.rejects(() => host.register([plugin]), /registration failed/);
  assert.equal(tools.has("t"), false);
  assert.equal(host.plugins().has("boom"), false);
});

test("host rejects two plugins claiming the model selector", async () => {
  const { host } = buildHost();
  const makeSelectorPlugin = (name: string): HarnessPlugin => ({
    name,
    capabilities: ["model-selector"],
    register(api: PluginApi) {
      api.setModelSelector({ select: () => ({ model: "m", reason: "profile" }) });
    },
  });
  await host.register([makeSelectorPlugin("a")]);
  await assert.rejects(() => host.register([makeSelectorPlugin("b")]), PluginLoadError);
});

test("host rejects two plugins claiming the compressor", async () => {
  const { host } = buildHost();
  const makeCompressorPlugin = (name: string): HarnessPlugin => ({
    name,
    capabilities: ["compressor"],
    register(api: PluginApi) {
      api.setCompressor(async () => ({
        summary: "s",
        highlights: [],
        supportHistory: [],
        overflowTurns: 0,
        compressed: false,
        forced: false,
        deltaTurns: 0,
      }));
    },
  });
  await host.register([makeCompressorPlugin("a")]);
  await assert.rejects(() => host.register([makeCompressorPlugin("b")]), PluginLoadError);
});

test("host throws when plugin requests skills without a configured skill registry", async () => {
  const tools = new ToolRegistry();
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const policy = new CompositePolicyEngine(new DefaultPolicyEngine());
  const host = new PluginHost({
    tools,
    providers,
    credentials,
    policy,
    onBeforeLoop: () => {},
    onAfterLoop: () => {},
    setCompressor: () => {},
    setModelSelector: () => {},
  });
  const plugin: HarnessPlugin = {
    name: "skills",
    capabilities: ["skills"],
    register(api: PluginApi) {
      api.registerSkill({
        name: "s",
        description: "skill",
        async execute() {
          return { ok: true };
        },
      });
    },
  };
  await assert.rejects(() => host.register([plugin]), PluginLoadError);
});

test("host throws when plugin uses observability without a configured provider", async () => {
  const { host } = buildHost();
  const plugin: HarnessPlugin = {
    name: "obs-missing",
    capabilities: ["observability"],
    register(api: PluginApi) {
      api.observability.registerTraceExporter({ export() {} });
    },
  };
  await assert.rejects(() => host.register([plugin]), PluginLoadError);
});

test("plugin registers observability exporters when provider exists", async () => {
  const tools = new ToolRegistry();
  const providers = new ProviderRegistry();
  const credentials = new CredentialsRegistry();
  const policy = new CompositePolicyEngine(new DefaultPolicyEngine());
  const provider = new DefaultObservabilityProvider({ traceExporters: [] });
  const host = new PluginHost({
    tools,
    providers,
    credentials,
    policy,
    onBeforeLoop: () => {},
    onAfterLoop: () => {},
    setCompressor: () => {},
    setModelSelector: () => {},
    observability: {
      tracer: provider.tracer,
      meter: provider.meter,
      logger: provider.logger,
      registerTraceExporter: (exporter) => provider.addTraceExporter(exporter),
      registerMetricExporter: (exporter) => provider.addMetricExporter(exporter),
      registerLogExporter: (exporter) => provider.addLogExporter(exporter),
    },
  });

  const memory = new InMemoryObservabilityExporter();
  const plugin: HarnessPlugin = {
    name: "otel-ish",
    capabilities: ["observability"],
    register(api: PluginApi) {
      api.observability.registerTraceExporter(memory);
    },
  };
  await host.register([plugin]);

  const span = provider.tracer.startSpan("test", { kind: "tool" });
  span.end();
  await provider.forceFlush();
  assert.equal(memory.getSpans().length, 1);
});

test("host throws when plugin uses undeclared capability", async () => {
  const { host } = buildHost();
  const plugin: HarnessPlugin = {
    name: "bad-cap",
    capabilities: ["tools"],
    register(api: PluginApi) {
      api.registerProvider({
        providerId: "p",
        defaultModel: "m",
        async complete() {
          return { assistantMessage: "", toolCalls: [], stop: true };
        },
      });
    },
  };
  await assert.rejects(() => host.register([plugin]), PluginCapabilityError);
});

test("plugin can register channel adapters when capability is declared", async () => {
  const { host, channels } = buildHost();
  const plugin: HarnessPlugin = {
    name: "channels",
    capabilities: ["channels"],
    register(api: PluginApi) {
      api.registerChannel({
        channelId: "email",
        description: "SMTP",
        transport: "smtp",
        async send() {
          return { channelId: "email", accepted: true, status: "sent", deliveries: [] };
        },
      });
    },
  };
  await host.register([plugin]);
  assert.equal(channels.has("email"), true);
});
