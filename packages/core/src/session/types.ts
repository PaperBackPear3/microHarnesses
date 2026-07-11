import type { InputAsset } from "../runtime/content";

export interface SessionManifest {
  sessionId: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  latestRunId?: string;
  latestSnapshotId?: string;
  latestSnapshotPath?: string;
  lastSnapshotSeq?: number;
  lastSnapshotTurnCount?: number;
  /** When set, this session is a child spawned by another session. */
  parentSessionId?: string;
  parentRunId?: string;
  rootSessionId?: string;
  depth?: number;
  spawnedByTool?: string;
  /** Relative path to the latest generated plan artifact (for example `plan.md`). */
  latestPlanPath?: string;
  latestPlanUpdatedAt?: string;
  latestPlanSizeBytes?: number;
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

export interface SaveInputAssetOptions {
  mimeType?: string;
  sourceKind?: "path" | "url";
}

export interface SessionInputAssetsFile {
  assets: InputAsset[];
}
