export interface SessionManifest {
  sessionId: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  latestRunId?: string;
  latestSnapshotId?: string;
  latestSnapshotPath?: string;
  eventLogPath: string;
  supportHistoryPath: string;
  lastEventSeq: number;
  /** When set, this session is a child spawned by another session. */
  parentSessionId?: string;
}
