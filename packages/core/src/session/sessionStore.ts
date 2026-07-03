import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ExecutionEvent, HarnessState, SessionManifest } from "../types";

interface SnapshotFile {
  id: string;
  createdAt: string;
  runId: string;
  state: HarnessState;
}

export class SessionStore {
  private readonly rootDir: string;

  constructor(stateDir: string) {
    this.rootDir = path.join(stateDir, "sessions");
  }

  async initSession(sessionId?: string, goal?: string): Promise<SessionManifest> {
    await mkdir(this.rootDir, { recursive: true });
    const effectiveSessionId = sessionId ?? `s-${randomUUID()}`;
    const sessionDir = this.sessionDir(effectiveSessionId);
    const manifestPath = path.join(sessionDir, "manifest.json");

    await mkdir(path.join(sessionDir, "snapshots"), { recursive: true });
    const existing = await this.readManifestIfExists(manifestPath);
    if (existing) {
      return existing;
    }

    const manifest: SessionManifest = {
      sessionId: effectiveSessionId,
      goal: goal ?? "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      eventLogPath: "events.jsonl",
      supportHistoryPath: "support-history.jsonl",
      lastEventSeq: 0
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  }

  async updateGoal(sessionId: string, goal: string): Promise<void> {
    const manifest = await this.readManifest(sessionId);
    const updated: SessionManifest = {
      ...manifest,
      goal,
      updatedAt: new Date().toISOString()
    };
    await this.writeManifest(updated);
  }

  async appendEvent(sessionId: string, event: ExecutionEvent): Promise<void> {
    const manifest = await this.readManifest(sessionId);
    const nextSeq = manifest.lastEventSeq + 1;
    const row = {
      seq: nextSeq,
      ...event
    };
    await appendFile(this.eventLogAbsolutePath(manifest), `${JSON.stringify(row)}\n`, "utf8");
    manifest.lastEventSeq = nextSeq;
    manifest.updatedAt = new Date().toISOString();
    await this.writeManifest(manifest);
  }

  async appendSupportHistory(sessionId: string, data: Record<string, unknown>): Promise<void> {
    const manifest = await this.readManifest(sessionId);
    const row = {
      timestamp: new Date().toISOString(),
      ...data
    };
    await appendFile(this.supportHistoryAbsolutePath(manifest), `${JSON.stringify(row)}\n`, "utf8");
    manifest.updatedAt = new Date().toISOString();
    await this.writeManifest(manifest);
  }

  async saveSnapshot(sessionId: string, runId: string, state: HarnessState): Promise<string> {
    const manifest = await this.readManifest(sessionId);
    const snapshotId = `snap-${randomUUID()}`;
    const snapshotRelPath = path.join("snapshots", `${snapshotId}.json`);
    const snapshotPath = path.join(this.sessionDir(sessionId), snapshotRelPath);
    const payload: SnapshotFile = {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      runId,
      state
    };
    await writeFile(snapshotPath, JSON.stringify(payload, null, 2), "utf8");

    const updated: SessionManifest = {
      ...manifest,
      latestRunId: runId,
      latestSnapshotId: snapshotId,
      latestSnapshotPath: snapshotRelPath,
      updatedAt: new Date().toISOString()
    };
    await this.writeManifest(updated);
    return snapshotId;
  }

  async loadLatestSnapshot(sessionId: string): Promise<HarnessState | undefined> {
    const manifest = await this.readManifest(sessionId);
    if (!manifest.latestSnapshotPath) {
      return undefined;
    }
    const snapshotPath = path.join(this.sessionDir(sessionId), manifest.latestSnapshotPath);
    const raw = await readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(raw) as SnapshotFile;
    return parsed.state;
  }

  async listSessions(): Promise<SessionManifest[]> {
    await mkdir(this.rootDir, { recursive: true });
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const manifests: SessionManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(this.rootDir, entry.name, "manifest.json");
      const manifest = await this.readManifestIfExists(manifestPath);
      if (manifest) {
        manifests.push(manifest);
      }
    }
    return manifests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(sessionId: string): Promise<SessionManifest> {
    return this.readManifest(sessionId);
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.rootDir, sessionId);
  }

  private eventLogAbsolutePath(manifest: SessionManifest): string {
    return path.join(this.sessionDir(manifest.sessionId), manifest.eventLogPath);
  }

  private supportHistoryAbsolutePath(manifest: SessionManifest): string {
    return path.join(this.sessionDir(manifest.sessionId), manifest.supportHistoryPath);
  }

  private async readManifest(sessionId: string): Promise<SessionManifest> {
    const manifestPath = path.join(this.sessionDir(sessionId), "manifest.json");
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw) as SessionManifest;
  }

  private async readManifestIfExists(manifestPath: string): Promise<SessionManifest | undefined> {
    try {
      const raw = await readFile(manifestPath, "utf8");
      return JSON.parse(raw) as SessionManifest;
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async writeManifest(manifest: SessionManifest): Promise<void> {
    const manifestPath = path.join(this.sessionDir(manifest.sessionId), "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}
