export interface SessionManifest {
  sessionId: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  latestRunId?: string;
  latestSnapshotId?: string;
  latestSnapshotPath?: string;
  lastSnapshotSeq?: number;
  supportHistoryPath: string;
  /** When set, this session is a child spawned by another session. */
  parentSessionId?: string;
  parentRunId?: string;
  rootSessionId?: string;
  depth?: number;
  spawnedByTool?: string;
}

export interface InitSessionOptions {
  sessionId?: string;
  goal?: string;
  parentSessionId?: string;
  parentRunId?: string;
  rootSessionId?: string;
  depth?: number;
  spawnedByTool?: string;
}
