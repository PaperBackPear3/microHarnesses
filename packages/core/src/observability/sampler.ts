import type { Sampler, SamplingInput } from "./types";

/** Samples every trace. */
export class AlwaysOnSampler implements Sampler {
  shouldSample(_input: SamplingInput): boolean {
    return true;
  }
}

/** Samples no traces. */
export class AlwaysOffSampler implements Sampler {
  shouldSample(_input: SamplingInput): boolean {
    return false;
  }
}

/**
 * Deterministically samples a fraction of traces based on the trace id, so the
 * decision is stable across a distributed trace (parent + children agree).
 */
export class TraceIdRatioSampler implements Sampler {
  private readonly threshold: number;

  constructor(ratio: number) {
    const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
    this.threshold = clamped;
  }

  shouldSample(input: SamplingInput): boolean {
    if (this.threshold >= 1) return true;
    if (this.threshold <= 0) return false;
    // Use the last 8 hex chars (32 bits) of the trace id as an unsigned ratio.
    const tail = input.traceId.slice(-8);
    const value = Number.parseInt(tail, 16);
    if (Number.isNaN(value)) return false;
    return value / 0xffffffff < this.threshold;
  }
}
