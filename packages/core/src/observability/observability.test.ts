import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { childContext, generateSpanId, generateTraceId, rootContext } from "./ids";
import { InMemoryObservabilityExporter } from "./inMemoryExporter";
import { JsonlObservabilityExporter } from "./jsonlExporter";
import { DefaultObservabilityProvider, createObservability } from "./provider";
import { createRedactor, resolveRedactionPolicy } from "./redaction";
import { AlwaysOffSampler, AlwaysOnSampler, TraceIdRatioSampler } from "./sampler";
import { HeuristicTokenCounter } from "./tokenCounter";

test("ids are W3C-sized lowercase hex", () => {
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  assert.match(traceId, /^[0-9a-f]{32}$/);
  assert.match(spanId, /^[0-9a-f]{16}$/);
});

test("childContext preserves trace id and links parent span", () => {
  const parent = rootContext();
  const child = childContext(parent);
  assert.equal(child.traceId, parent.traceId);
  assert.equal(child.parentSpanId, parent.spanId);
  assert.notEqual(child.spanId, parent.spanId);
});

test("samplers behave as documented", () => {
  const input = { traceId: generateTraceId(), name: "s", kind: "run" as const };
  assert.equal(new AlwaysOnSampler().shouldSample(input), true);
  assert.equal(new AlwaysOffSampler().shouldSample(input), false);
  assert.equal(new TraceIdRatioSampler(1).shouldSample(input), true);
  assert.equal(new TraceIdRatioSampler(0).shouldSample(input), false);
});

test("TraceIdRatioSampler is deterministic for a given trace id", () => {
  const sampler = new TraceIdRatioSampler(0.5);
  const traceId = "0".repeat(32);
  const first = sampler.shouldSample({ traceId, name: "a", kind: "run" });
  const second = sampler.shouldSample({ traceId, name: "b", kind: "tool" });
  assert.equal(first, second);
});

test("heuristic token counter approximates 4 chars per token", () => {
  const counter = new HeuristicTokenCounter(4);
  assert.equal(counter.count(""), 0);
  assert.equal(counter.count("abcd"), 1);
  assert.equal(counter.count("abcde"), 2);
});

test("redactor masks denied keys and truncates long values", () => {
  const policy = resolveRedactionPolicy({ maxValueLength: 5, denyKeys: ["token"] });
  const redact = createRedactor(policy);
  const out = redact({ token: "secret-value", note: "abcdefgh", api_key: "k" });
  assert.equal(out.token, "[REDACTED]");
  assert.equal(out.api_key, "[REDACTED]");
  assert.equal(out.note, "abcd…");
});

test("privacy mode drops content attribute bags", () => {
  const redact = createRedactor(resolveRedactionPolicy({ privacyMode: true }));
  assert.deepEqual(redact({ prompt: "sensitive" }, true), {});
  // Non-content metadata still passes through.
  assert.deepEqual(redact({ iteration: 1 }, false), { iteration: 1 });
});

test("captureContent:false drops content but keeps metadata", () => {
  const redact = createRedactor(resolveRedactionPolicy({ captureContent: false }));
  assert.deepEqual(redact({ output: "x" }, true), {});
  assert.deepEqual(redact({ tool: "echo" }, false), { tool: "echo" });
});

test("provider exports spans, metrics, and logs to configured exporters", async () => {
  const memory = new InMemoryObservabilityExporter();
  const provider = createObservability({
    traceExporters: [memory],
    metricExporters: [memory],
    logExporters: [memory],
    logLevel: "debug",
  });

  const span = provider.tracer.startSpan("op", { kind: "tool", attributes: { a: 1 } });
  span.addEvent("did-something", { k: "v" });
  span.setStatus({ code: "ok" });
  span.end();

  provider.meter.createCounter("things").add(2, { kind: "widget" });
  provider.meter.createHistogram("latency").record(12);
  provider.logger.info("hello", { scope: "test" });
  provider.logger.debug("filtered?", {});

  await provider.forceFlush();

  const spans = memory.getSpans();
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.name, "op");
  assert.equal(spans[0]?.durationMs >= 0, true);
  assert.equal(spans[0]?.events[0]?.name, "did-something");

  const metrics = memory.getMetrics();
  assert.equal(
    metrics.some((m) => m.name === "things" && m.value === 2 && m.kind === "counter"),
    true,
  );
  assert.equal(
    metrics.some((m) => m.name === "latency" && m.kind === "histogram"),
    true,
  );

  const logs = memory.getLogs();
  assert.equal(
    logs.some((l) => l.message === "hello" && l.level === "info"),
    true,
  );
});

test("logger drops records below the configured level", async () => {
  const memory = new InMemoryObservabilityExporter();
  const provider = createObservability({ logExporters: [memory], logLevel: "warn" });
  provider.logger.info("dropped");
  provider.logger.error("kept");
  await provider.forceFlush();
  const messages = memory.getLogs().map((l) => l.message);
  assert.equal(messages.includes("dropped"), false);
  assert.equal(messages.includes("kept"), true);
});

test("disabled provider is a zero-overhead no-op", async () => {
  const memory = new InMemoryObservabilityExporter();
  const provider = createObservability({ enabled: false, traceExporters: [memory] });
  const span = provider.tracer.startSpan("op", { kind: "run" });
  span.setAttribute("x", 1).end();
  provider.meter.createCounter("c").add(1);
  await provider.forceFlush();
  assert.equal(memory.getSpans().length, 0);
  assert.equal(memory.getMetrics().length, 0);
});

test("child spans inherit the parent trace id", () => {
  const memory = new InMemoryObservabilityExporter();
  const provider = new DefaultObservabilityProvider({ traceExporters: [memory] });
  const parent = provider.tracer.startSpan("parent", { kind: "run" });
  const child = provider.tracer.startSpan("child", { kind: "tool", parent });
  assert.equal(child.context.traceId, parent.context.traceId);
  assert.equal(child.context.parentSpanId, parent.context.spanId);
});

test("unsampled spans still carry a propagatable context but are not exported", async () => {
  const memory = new InMemoryObservabilityExporter();
  const provider = createObservability({
    sampler: new AlwaysOffSampler(),
    traceExporters: [memory],
  });
  const span = provider.tracer.startSpan("op", { kind: "run" });
  assert.match(span.context.traceId, /^[0-9a-f]{32}$/);
  span.end();
  await provider.forceFlush();
  assert.equal(memory.getSpans().length, 0);
});

test("jsonl exporter appends spans, metrics, and logs to files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mh-obs-jsonl-"));
  try {
    const exporter = new JsonlObservabilityExporter({ dir });
    const provider = createObservability({
      traceExporters: [exporter],
      metricExporters: [exporter],
      logExporters: [exporter],
      logLevel: "info",
    });
    provider.tracer.startSpan("op", { kind: "tool" }).end();
    provider.meter.createCounter("c").add(1);
    provider.logger.info("line");
    await provider.forceFlush();

    const spans = await readFile(path.join(dir, "spans.jsonl"), "utf8");
    const metrics = await readFile(path.join(dir, "metrics.jsonl"), "utf8");
    const logs = await readFile(path.join(dir, "logs.jsonl"), "utf8");
    assert.match(spans, /"name":"op"/);
    assert.match(metrics, /"name":"c"/);
    assert.match(logs, /"message":"line"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
