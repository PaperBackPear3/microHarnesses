import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { AgentSpawner, SpawnRequest } from "../types";

export interface LocalProcessSpawnerOptions {
  /** Additional environment variables to pass to the worker process. */
  extraEnv?: Record<string, string>;
}

export class LocalProcessSpawner implements AgentSpawner {
  private readonly workerScriptPath: string;
  private readonly extraEnv: Record<string, string>;

  constructor(workerScriptPath: string, options: LocalProcessSpawnerOptions = {}) {
    this.workerScriptPath = workerScriptPath;
    this.extraEnv = options.extraEnv ?? {};
  }

  async spawn(request: SpawnRequest): Promise<string> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "micro-harness-worker-"));
    const inputPath = path.join(tmpDir, "input.json");
    const outputPath = path.join(tmpDir, "output.json");
    await writeFile(inputPath, JSON.stringify({ prompt: request.prompt }, null, 2), "utf8");

    try {
      await runWorker(this.workerScriptPath, inputPath, outputPath, this.extraEnv);
      const raw = await readFile(outputPath, "utf8");
      const result = JSON.parse(raw) as { summary?: string; error?: string };
      if (result.error) {
        throw new Error(result.error);
      }
      return result.summary ?? "worker returned no summary";
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}

function runWorker(
  workerScriptPath: string,
  inputPath: string,
  outputPath: string,
  extraEnv: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerScriptPath, inputPath, outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "", ...extraEnv }
    });
    child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Worker exited with code ${String(code)}`));
      }
    });
  });
}
