/**
 * Manually maintained reference data for well-known hosted models: context
 * window size and USD list pricing per 1M tokens.
 *
 * No mainstream provider API (OpenAI, Anthropic, etc.) returns pricing, and
 * hosted `models.list()` responses rarely include context window either (see
 * `anthropicAdapter.ts#listModels` for the one exception found so far).
 * Tools that need this data — this project included, following the same
 * approach as e.g. LiteLLM's `model_prices_and_context_window.json` — have
 * to maintain it by hand from published pricing pages and update it as
 * providers change models/prices. Treat this table as best-effort reference
 * data, not a live source of truth; entries can drift out of date.
 *
 * Local providers (Ollama) are the exception: real context window is
 * discovered live per-model via the Ollama `/api/show` endpoint (see
 * `contextWindow.ts`), and cost is always 0 since inference is local, so
 * those models intentionally have no catalog entry here.
 *
 * Freshness policy: only keep entries for models released within the last
 * ~365 days. Older entries are dropped rather than kept as legacy fallback —
 * a stale price/context figure silently attached to a deprecated model id is
 * worse than falling back to the coarse tier heuristic in `modelRoutes.ts`.
 * When updating this table, drop any entry older than the window and add the
 * new generation's models with a verified release date comment.
 */
export interface KnownModelInfo {
  contextWindowTokens?: number;
  /** USD list price per 1M input tokens. */
  inputCostPerMillionTokens?: number;
  /** USD list price per 1M output tokens. */
  outputCostPerMillionTokens?: number;
}

/**
 * Keyed by model id prefix (matched via `startsWith`, longest match wins) so
 * dated/suffixed ids like `gpt-5.4-mini-2026-03-17` still resolve without
 * listing every snapshot. Last reviewed 2026-07-07 against official pricing
 * pages (cross-checked via https://www.tldl.io); all entries below are
 * within the last-365-days freshness window as of that date — see per-entry
 * release date comments.
 */
const KNOWN_MODEL_PREFIXES: Record<string, KnownModelInfo> = {
  // OpenAI (https://openai.com/api/pricing/)
  "gpt-5.4-nano": {
    // Released 2026-03-17.
    inputCostPerMillionTokens: 0.2,
    outputCostPerMillionTokens: 1.25,
  },
  "gpt-5.4-mini": {
    // Released 2026-03-17.
    contextWindowTokens: 400_000,
    inputCostPerMillionTokens: 0.75,
    outputCostPerMillionTokens: 4.5,
  },
  "gpt-5.4": {
    // Released 2026-03-05.
    contextWindowTokens: 1_000_000,
    inputCostPerMillionTokens: 2.5,
    outputCostPerMillionTokens: 15,
  },
  "gpt-5.5": {
    // Released 2026-04-23.
    contextWindowTokens: 1_000_000,
    inputCostPerMillionTokens: 5,
    outputCostPerMillionTokens: 30,
  },

  // Anthropic (https://www.anthropic.com/pricing#api). Claude Sonnet 5's
  // $2/$10 rate is introductory through 2026-08-31; it rises to $3/$15
  // (matching claude-sonnet-4-6's rate) from 2026-09-01 — update then.
  "claude-opus-4-8": {
    // Released 2026-05-28.
    contextWindowTokens: 1_000_000,
    inputCostPerMillionTokens: 5,
    outputCostPerMillionTokens: 25,
  },
  "claude-sonnet-5": {
    // Released 2026-06-30.
    contextWindowTokens: 1_000_000,
    inputCostPerMillionTokens: 2,
    outputCostPerMillionTokens: 10,
  },
  "claude-sonnet-4-6": {
    // Released 2026-02-17.
    inputCostPerMillionTokens: 3,
    outputCostPerMillionTokens: 15,
  },
  "claude-haiku-4-5": {
    // Released 2025-10-16.
    contextWindowTokens: 200_000,
    inputCostPerMillionTokens: 1,
    outputCostPerMillionTokens: 5,
  },
};

/**
 * Looks up known context window/pricing for a model id, matching the
 * longest known prefix (so dated snapshots resolve to their model family).
 * Returns `undefined` for models not in the maintained table (e.g. local
 * Ollama models, or new/unlisted hosted models) — callers should fall back
 * to heuristics or live discovery in that case.
 */
export function lookupKnownModelInfo(model: string): KnownModelInfo | undefined {
  let best: { prefix: string; info: KnownModelInfo } | undefined;
  for (const [prefix, info] of Object.entries(KNOWN_MODEL_PREFIXES)) {
    if (!model.startsWith(prefix)) continue;
    if (!best || prefix.length > best.prefix.length) {
      best = { prefix, info };
    }
  }
  return best?.info;
}

/**
 * Converts real USD pricing into the relative 1-3 `cost` rating used by
 * {@link ModelRouter} scoring, so catalog-informed and heuristic-tiered
 * routes remain comparable. Blends input/output price, weighting output
 * tokens higher since completions are typically the pricier and more
 * numerous side of a request.
 */
export function costRatingFromPricing(info: KnownModelInfo): number | undefined {
  if (
    info.inputCostPerMillionTokens === undefined &&
    info.outputCostPerMillionTokens === undefined
  ) {
    return undefined;
  }
  const input = info.inputCostPerMillionTokens ?? 0;
  const output = info.outputCostPerMillionTokens ?? input;
  const blended = (input + output * 3) / 4;
  // Thresholds are calibrated against the table above (spans ~$0.2 to ~$24
  // blended per 1M tokens across the current model generation) so
  // cheap/mid/flagship-tier models land in distinct buckets; revisit
  // whenever the table's price range shifts materially.
  if (blended < 2) return 1;
  if (blended < 10) return 2;
  return 3;
}
