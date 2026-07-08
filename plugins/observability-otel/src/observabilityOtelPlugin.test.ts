import assert from "node:assert/strict";
import test from "node:test";
import type { PluginApi } from "@micro-harnesses/core";
import { ObservabilityOtelPlugin } from "./observabilityOtelPlugin";

function createApiRecorder() {
  const traces: unknown[] = [];
  const metrics: unknown[] = [];
  const logs: unknown[] = [];
  const api: PluginApi = {
    registerTool() {},
    registerChannel() {},
    registerSkill() {},
    onBeforeLoop() {},
    onAfterLoop() {},
    setCompressor() {},
    registerProvider() {},
    registerCredentialsResolver() {},
    registerPolicyRule() {},
    setModelSelector() {},
    observability: {
      tracer: {} as never,
      meter: {} as never,
      logger: {} as never,
      registerTraceExporter(exporter) {
        traces.push(exporter);
      },
      registerMetricExporter(exporter) {
        metrics.push(exporter);
      },
      registerLogExporter(exporter) {
        logs.push(exporter);
      },
    },
    agents: {
      async spawn() {
        throw new Error("not implemented");
      },
      async invoke() {
        throw new Error("not implemented");
      },
    },
  };
  return { api, traces, metrics, logs };
}

test("registers exporters for enabled signals", () => {
  const { api, traces, metrics, logs } = createApiRecorder();
  const plugin = new ObservabilityOtelPlugin({
    endpoint: "http://localhost:4318",
    metrics: { mode: "otlp" },
  });
  plugin.register(api);
  assert.equal(traces.length, 1);
  assert.equal(metrics.length, 1);
  assert.equal(logs.length, 1);
});

test("respects enabled=false toggles", () => {
  const { api, traces, metrics, logs } = createApiRecorder();
  const plugin = new ObservabilityOtelPlugin({
    traces: { enabled: false },
    metrics: { mode: "otlp", enabled: false },
    logs: { enabled: false },
  });
  plugin.register(api);
  assert.equal(traces.length, 0);
  assert.equal(metrics.length, 0);
  assert.equal(logs.length, 0);
});
