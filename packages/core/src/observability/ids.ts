import { randomBytes } from "node:crypto";
import type { TraceContext } from "./types";

/** Generates a W3C-compatible 16-byte trace id as lowercase hex (32 chars). */
export function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

/** Generates a W3C-compatible 8-byte span id as lowercase hex (16 chars). */
export function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

/** Creates a child trace context, preserving the trace id and linking the parent span. */
export function childContext(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
  };
}

/** Creates a fresh root trace context. */
export function rootContext(): TraceContext {
  return { traceId: generateTraceId(), spanId: generateSpanId() };
}
