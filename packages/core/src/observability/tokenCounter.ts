import type { TokenCounter } from "./types";

/**
 * Zero-dependency heuristic token counter. Uses the common ~4-characters-per-
 * token approximation. Consumers that need exact counts can supply a real
 * tokenizer via {@link ObservabilityConfig.tokenCounter}.
 */
export class HeuristicTokenCounter implements TokenCounter {
  private readonly charsPerToken: number;

  constructor(charsPerToken = 4) {
    this.charsPerToken = charsPerToken > 0 ? charsPerToken : 4;
  }

  count(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / this.charsPerToken);
  }
}
