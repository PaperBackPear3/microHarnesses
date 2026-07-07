import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunState } from "../runtime/state";
import { isNodeError } from "../shared/nodeError";
import type { InitSessionOptions, SessionManifest } from "./types";

interface SnapshotFile {
  id: string;
  createdAt: string;
  seq: number;
  runId: string;
  state: RunState;
}

export class SessionStore {
  private readonly rootDir: string;

  constructor(stateDir: string) {
    this.rootDir = path.join(stateDir, "sessions");
  }

  async initSession(options: InitSessionOptions = {}): Promise<SessionManifest> {
    await mkdir(this.rootDir, { recursive: true });
    const effectiveSessionId = options.sessionId ?? `s-${randomUUID()}`;
    const sessionDir = this.sessionDir(effectiveSessionId);
    const manifestPath = path.join(sessionDir, "manifest.json");

    await mkdir(path.join(sessionDir, "snapshots"), { recursive: true });
    const existing = await this.readManifestIfExists(manifestPath);
    if (existing) {
      return existing;
    }

    const manifest: SessionManifest = {
      sessionId: effectiveSessionId,
      goal: options.goal ?? "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(options.parentSessionId ? { parentSessionId: options.parentSessionId } : {}),
      ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
      ...(options.rootSessionId ? { rootSessionId: options.rootSessionId } : {}),
      ...(typeof options.depth === "number" ? { depth: options.depth } : {}),
      ...(options.spawnedByTool ? { spawnedByTool: options.spawnedByTool } : {}),
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  }

  async updateGoal(sessionId: string, goal: string): Promise<void> {
    const manifest = await this.readManifest(sessionId);
    const updated: SessionManifest = {
      ...manifest,
      goal,
      updatedAt: new Date().toISOString(),
    };
    await this.writeManifest(updated);
  }

  async appendSupportHistory(sessionId: string, data: Record<string, unknown>): Promise<void> {
    const manifest = await this.readManifest(sessionId);
    const row = {
      timestamp: new Date().toISOString(),
      ...data,
    };
    await appendFile(
      this.supportHistoryAbsolutePath(sessionId),
      `${JSON.stringify(row)}\n`,
      "utf8",
    );
    manifest.updatedAt = new Date().toISOString();
    await this.writeManifest(manifest);
  }

  async saveSnapshot(sessionId: string, runId: string, state: RunState): Promise<string> {
    const manifest = await this.readManifest(sessionId);
    const snapshotId = `snap-${randomUUID()}`;
    const snapshotSeq = (manifest.lastSnapshotSeq ?? 0) + 1;
    const snapshotRelPath = path.join("snapshots", `${snapshotId}.json`);
    const snapshotPath = path.join(this.sessionDir(sessionId), snapshotRelPath);
    const previousSnapshotTurnCount = Math.max(0, manifest.lastSnapshotTurnCount ?? 0);
    const previousTurnCount =
      state.turns.length > previousSnapshotTurnCount ? previousSnapshotTurnCount : 0;
    if (
      manifest.latestSnapshotId &&
      manifest.latestSnapshotPath &&
      state.turns.length === previousSnapshotTurnCount
    ) {
      await this.writeManifest({
        ...manifest,
        latestRunId: runId,
        updatedAt: new Date().toISOString(),
      });
      return manifest.latestSnapshotId;
    }

    const payload: SnapshotFile = {
      id: snapshotId,
      createdAt: new Date().toISOString(),
      seq: snapshotSeq,
      runId,
      state: {
        ...state,
        turns: state.turns.slice(previousTurnCount),
      },
    };
    await writeFile(snapshotPath, JSON.stringify(payload, null, 2), "utf8");

    const updated: SessionManifest = {
      ...manifest,
      latestRunId: runId,
      latestSnapshotId: snapshotId,
      latestSnapshotPath: snapshotRelPath,
      lastSnapshotSeq: snapshotSeq,
      lastSnapshotTurnCount: state.turns.length,
      updatedAt: new Date().toISOString(),
    };
    await this.writeManifest(updated);
    return snapshotId;
  }

  async loadLatestSnapshot(sessionId: string): Promise<RunState | undefined> {
    const manifest = await this.readManifest(sessionId);
    if (!manifest.latestSnapshotPath) {
      return undefined;
    }
    const snapshots = await this.readAllSnapshots(sessionId);
    if (snapshots.length === 0) {
      return undefined;
    }
    const latest = snapshots[snapshots.length - 1];
    if (!latest) {
      return undefined;
    }
    const seenTurnIds = new Set<string>();
    const mergedTurns: RunState["turns"] = [];
    for (const snapshot of snapshots) {
      for (const turn of snapshot.state.turns) {
        if (seenTurnIds.has(turn.id)) {
          continue;
        }
        seenTurnIds.add(turn.id);
        mergedTurns.push(turn);
      }
    }
    return {
      ...latest.state,
      turns: mergedTurns,
    };
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

  async getSessionIfExists(sessionId: string): Promise<SessionManifest | undefined> {
    const manifestPath = path.join(this.sessionDir(sessionId), "manifest.json");
    return this.readManifestIfExists(manifestPath);
  }

  private sessionDir(sessionId: string): string {
    return path.join(this.rootDir, sessionId);
  }

  private supportHistoryAbsolutePath(sessionId: string): string {
    return path.join(this.sessionDir(sessionId), "support-history.jsonl");
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

  private async readAllSnapshots(sessionId: string): Promise<SnapshotFile[]> {
    const snapshotsDir = path.join(this.sessionDir(sessionId), "snapshots");
    const entries = await readdir(snapshotsDir, { withFileTypes: true });
    const snapshots = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const snapshotPath = path.join(snapshotsDir, entry.name);
          const raw = await readFile(snapshotPath, "utf8");
          return JSON.parse(raw) as SnapshotFile;
        }),
    );
    snapshots.sort((a, b) => {
      const seqA = a.seq ?? 0;
      const seqB = b.seq ?? 0;
      if (seqA !== seqB) {
        return seqA - seqB;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
    return snapshots;
  }
}
