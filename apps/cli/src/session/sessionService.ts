import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { type SessionManifest, SessionStore } from "@micro-harnesses/core";

export interface SessionSummary {
  manifest: SessionManifest;
  telemetry: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    errors: number;
  };
  artifacts: {
    sessionDir: string;
    entries: string[];
    plan: {
      path: string;
      exists: boolean;
      updatedAt?: string;
      sizeBytes?: number;
    };
  };
}

export class SessionService {
  private readonly sessionStore: SessionStore;
  private readonly stateDir: string;

  constructor(stateDir: string) {
    this.sessionStore = new SessionStore(stateDir);
    this.stateDir = stateDir;
  }

  async listSummaries(): Promise<SessionSummary[]> {
    const sessions = await this.sessionStore.listSessions();
    return await Promise.all(
      sessions.map(async (manifest) => ({
        manifest,
        telemetry: await this.readTelemetrySummary(manifest.sessionId),
        artifacts: await this.readArtifactSummary(manifest),
      })),
    );
  }

  async getDetails(sessionId: string): Promise<SessionSummary> {
    const manifest = await this.sessionStore.getSession(sessionId);
    return {
      manifest,
      telemetry: await this.readTelemetrySummary(sessionId),
      artifacts: await this.readArtifactSummary(manifest),
    };
  }

  getStore(): SessionStore {
    return this.sessionStore;
  }

  private async readTelemetrySummary(sessionId: string): Promise<SessionSummary["telemetry"]> {
    const metricsPath = path.join(
      this.stateDir,
      "sessions",
      sessionId,
      "telemetry",
      "metrics.jsonl",
    );
    try {
      const raw = await readFile(metricsPath, "utf8");
      const lines = raw.split("\n").filter((line) => line.trim().length > 0);
      let turns = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let errors = 0;
      for (const line of lines) {
        const row = JSON.parse(line) as {
          name?: string;
          value?: number;
          attributes?: Record<string, unknown>;
        };
        if (row.name === "agent.iterations") turns += row.value ?? 0;
        if (row.name === "model.tokens") {
          const direction = row.attributes?.direction;
          if (direction === "input") inputTokens += row.value ?? 0;
          if (direction === "output") outputTokens += row.value ?? 0;
        }
        if (row.name === "errors") errors += row.value ?? 0;
      }
      return { turns, inputTokens, outputTokens, errors };
    } catch {
      return { turns: 0, inputTokens: 0, outputTokens: 0, errors: 0 };
    }
  }

  private async readArtifactSummary(
    manifest: SessionManifest,
  ): Promise<SessionSummary["artifacts"]> {
    const sessionDir = path.join(this.stateDir, "sessions", manifest.sessionId);
    const planPath = path.join(
      sessionDir,
      manifest.latestPlanPath && manifest.latestPlanPath.trim().length > 0
        ? manifest.latestPlanPath
        : "plan.md",
    );

    let entries: string[] = [];
    try {
      entries = (await readdir(sessionDir)).sort((a, b) => a.localeCompare(b));
    } catch {
      entries = [];
    }

    try {
      const info = await stat(planPath);
      return {
        sessionDir,
        entries,
        plan: {
          path: planPath,
          exists: true,
          updatedAt: info.mtime.toISOString(),
          sizeBytes: info.size,
        },
      };
    } catch {
      return {
        sessionDir,
        entries,
        plan: {
          path: planPath,
          exists: false,
        },
      };
    }
  }
}
