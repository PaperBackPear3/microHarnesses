import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface WorkerInput {
  prompt: string;
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    throw new Error("worker expects input and output paths");
  }

  const raw = await readFile(inputPath, "utf8");
  const input = JSON.parse(raw) as WorkerInput;
  const result = {
    summary: `Worker processed: ${input.prompt}`,
  };

  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown worker error";
  const outputPath = process.argv[3];
  if (outputPath) {
    void writeFile(path.resolve(outputPath), JSON.stringify({ error: message }, null, 2), "utf8");
  }
  process.exit(1);
});
