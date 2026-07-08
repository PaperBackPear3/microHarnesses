export type AnalysisConfidence = "low" | "medium" | "high";

export interface AnalysisCategory {
  name: string;
  confidence: AnalysisConfidence;
  reason: string;
}

export interface AnalysisClarification {
  issue: string;
  bestEffortInterpretation: string;
  whatWouldHelp: string;
}

export interface AnalysisItem {
  source: string;
  mimeType: string;
  summary: string;
  categories: string[];
}

export interface AnalysisResult {
  summary: string;
  categories: AnalysisCategory[];
  clarifications: AnalysisClarification[];
  items: AnalysisItem[];
}

export interface AnalysisResponse extends AnalysisResult {
  sessionId: string;
  runId: string;
  rawAssistantMessage: string;
  provider: string;
  model: string;
}

export function parseAnalysisResult(raw: string): AnalysisResult {
  const parsed = JSON.parse(extractJson(raw)) as unknown;
  return normalizeAnalysisResult(parsed);
}

export function normalizeAnalysisResult(value: unknown): AnalysisResult {
  if (!value || typeof value !== "object") {
    throw new Error("Analysis output must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  return {
    summary: requireString(record.summary, "summary"),
    categories: normalizeCategories(record.categories),
    clarifications: normalizeClarifications(record.clarifications),
    items: normalizeItems(record.items),
  };
}

export function mergeAnalysisResults(results: AnalysisResult[]): AnalysisResult {
  const categories = new Map<string, AnalysisCategory>();
  const clarifications = new Map<string, AnalysisClarification>();
  const items: AnalysisItem[] = [];
  let summary = "";

  for (const result of results) {
    if (!summary && result.summary.trim().length > 0) {
      summary = result.summary.trim();
    }
    for (const category of result.categories) {
      const key = category.name.trim().toLowerCase();
      const existing = categories.get(key);
      if (!existing || rankConfidence(category.confidence) > rankConfidence(existing.confidence)) {
        categories.set(key, category);
      }
    }
    for (const clarification of result.clarifications) {
      const key = clarification.issue.trim().toLowerCase();
      if (!clarifications.has(key)) {
        clarifications.set(key, clarification);
      }
    }
    items.push(...result.items);
  }

  return {
    summary,
    categories: [...categories.values()],
    clarifications: [...clarifications.values()],
    items,
  };
}

export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }
  throw new Error("No JSON object found in model output");
}

function normalizeCategories(value: unknown): AnalysisCategory[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Category entries must be objects");
    }
    const record = item as Record<string, unknown>;
    return {
      name: requireString(record.name, "categories[].name"),
      confidence: normalizeConfidence(record.confidence),
      reason: requireString(record.reason, "categories[].reason"),
    };
  });
}

function normalizeClarifications(value: unknown): AnalysisClarification[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Clarification entries must be objects");
    }
    const record = item as Record<string, unknown>;
    return {
      issue: requireString(record.issue, "clarifications[].issue"),
      bestEffortInterpretation: requireString(
        record.bestEffortInterpretation,
        "clarifications[].bestEffortInterpretation",
      ),
      whatWouldHelp: requireString(record.whatWouldHelp, "clarifications[].whatWouldHelp"),
    };
  });
}

function normalizeItems(value: unknown): AnalysisItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Item entries must be objects");
    }
    const record = item as Record<string, unknown>;
    return {
      source: requireString(record.source, "items[].source"),
      mimeType: requireString(record.mimeType, "items[].mimeType"),
      summary: requireString(record.summary, "items[].summary"),
      categories: normalizeStringArray(record.categories, "items[].categories"),
    };
  });
}

function normalizeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${field}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
}

function normalizeConfidence(value: unknown): AnalysisConfidence {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error("categories[].confidence must be low, medium, or high");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function rankConfidence(confidence: AnalysisConfidence): number {
  if (confidence === "low") return 1;
  if (confidence === "medium") return 2;
  return 3;
}
