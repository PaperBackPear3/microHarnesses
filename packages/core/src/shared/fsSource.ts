import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isNodeError } from "./nodeError";

export function resolveSourceRoot(rootDir: string): string {
  return path.resolve(rootDir);
}

export async function readOptionalTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function readOptionalJsonFile<T>(filePath: string): Promise<T | undefined> {
  const raw = await readOptionalTextFile(filePath);
  if (raw === undefined) {
    return undefined;
  }
  return JSON.parse(raw) as T;
}

export async function listDirectoryNames(rootDir: string): Promise<string[]> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
