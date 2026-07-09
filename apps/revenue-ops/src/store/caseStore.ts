import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isNodeError } from "@micro-harnesses/core";
import type { CaseKind, CaseOutcome, RevenueOpsCase } from "../domain/types.js";

interface CaseStorePayload {
  cases: RevenueOpsCase[];
}

export class JsonCaseStore {
  private readonly filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, "cases.json");
  }

  async upsert(input: RevenueOpsCase): Promise<RevenueOpsCase> {
    const all = await this.readAll();
    const next = all.filter((item) => item.id !== input.id);
    next.push(input);
    await this.writeAll(next);
    return input;
  }

  async get(id: string): Promise<RevenueOpsCase | undefined> {
    const all = await this.readAll();
    return all.find((item) => item.id === id);
  }

  async list(): Promise<RevenueOpsCase[]> {
    return this.readAll();
  }

  async findByKindEntity(kind: CaseKind, entityId: string): Promise<RevenueOpsCase | undefined> {
    const all = await this.readAll();
    return all.find((item) => item.kind === kind && item.entityId === entityId);
  }

  async recordOutcome(id: string, outcome: CaseOutcome): Promise<RevenueOpsCase> {
    const current = await this.get(id);
    if (!current) throw new Error(`Case not found: ${id}`);
    const updated: RevenueOpsCase = {
      ...current,
      outcomes: [...current.outcomes, outcome],
      updatedAt: outcome.at,
    };
    await this.upsert(updated);
    return updated;
  }

  private async readAll(): Promise<RevenueOpsCase[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CaseStorePayload;
      return Array.isArray(parsed.cases) ? parsed.cases : [];
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async writeAll(cases: RevenueOpsCase[]): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const payload: CaseStorePayload = { cases };
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
