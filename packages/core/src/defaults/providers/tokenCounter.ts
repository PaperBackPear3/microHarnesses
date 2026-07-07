import { HeuristicTokenCounter } from "../../observability/tokenCounter";
import type { TokenCounter } from "../../observability/types";

const FALLBACK_COUNTER = new HeuristicTokenCounter();

class TiktokenTokenCounter implements TokenCounter {
  constructor(private readonly encode: (text: string) => number) {}

  count(text: string): number {
    if (text.length === 0) return 0;
    return this.encode(text);
  }
}

/**
 * Best-effort OpenAI-compatible token counter.
 *
 * Uses tiktoken's model mapping when available; otherwise chooses a strong
 * default encoding based on model family.
 */
export async function createOpenAICompatibleTokenCounter(model: string): Promise<{
  counter: TokenCounter;
  estimator: string;
}> {
  try {
    const { encodingForModel, getEncoding } = await import("js-tiktoken");
    const selected = resolveEncodingName(model);
    const encodingName =
      selected ?? (model.toLowerCase().includes("embedding") ? "cl100k_base" : "o200k_base");
    const encoding = selected
      ? getEncoding(selected)
      : encodingForModel(model as Parameters<typeof encodingForModel>[0]);
    return {
      counter: new TiktokenTokenCounter((text) => encoding.encode(text).length),
      estimator: `tiktoken:${encodingName}`,
    };
  } catch {
    return { counter: FALLBACK_COUNTER, estimator: "heuristic" };
  }
}

function resolveEncodingName(model: string): "o200k_base" | "cl100k_base" | undefined {
  const normalized = model.toLowerCase();
  if (
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.startsWith("gpt-4o") ||
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("gpt-4.1") ||
    normalized.startsWith("gpt-4.5")
  ) {
    return "o200k_base";
  }
  if (normalized.startsWith("text-embedding-3")) {
    return "cl100k_base";
  }
  return undefined;
}
