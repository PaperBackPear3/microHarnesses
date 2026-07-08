export type MessageContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      assetId: string;
      mimeType: string;
      detail?: "low" | "high" | "auto";
      altText?: string;
    }
  | {
      type: "file";
      assetId: string;
      mimeType: string;
      filename: string;
      title?: string;
    };

export interface InputAsset {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  source?: { kind: "path" | "url"; value: string };
  sha256?: string;
  createdAt: string;
}
