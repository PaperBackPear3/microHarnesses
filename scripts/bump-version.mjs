#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const nextVersion = process.argv[2];
if (!nextVersion || !isSemver(nextVersion)) {
  process.stderr.write(
    "Usage: npm run version:bump -- <x.y.z[-pre]>\nExample: npm run version:bump -- 2.1.1\n",
  );
  process.exit(1);
}

const repoRoot = process.cwd();
const packageJsonPaths = [
  "package.json",
  "packages/core/package.json",
  "plugins/plan-mode/package.json",
  "plugins/example-tools/package.json",
  "plugins/basic-tools/package.json",
  "plugins/agentic-compression/package.json",
  "apps/cli/package.json",
];

for (const relativePath of packageJsonPaths) {
  const absolutePath = path.join(repoRoot, relativePath);
  const raw = readFileSync(absolutePath, "utf8");
  const parsed = JSON.parse(raw);

  if (typeof parsed.version === "string") {
    parsed.version = nextVersion;
  }

  bumpInternalRanges(parsed.dependencies, nextVersion);
  bumpInternalRanges(parsed.devDependencies, nextVersion);
  bumpInternalRanges(parsed.peerDependencies, nextVersion);
  bumpInternalRanges(parsed.optionalDependencies, nextVersion);

  writeFileSync(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  process.stdout.write(`Updated ${relativePath}\n`);
}

execFileSync("npx", ["biome", "check", "--write", ...packageJsonPaths], {
  cwd: repoRoot,
  stdio: "inherit",
});

execFileSync("npm", ["install", "--package-lock-only"], {
  cwd: repoRoot,
  stdio: "inherit",
});

process.stdout.write(`\nVersion bump complete: ${nextVersion}\n`);

function bumpInternalRanges(deps, version) {
  if (!deps || typeof deps !== "object") return;
  for (const name of Object.keys(deps)) {
    if (!name.startsWith("@micro-harnesses/")) continue;
    deps[name] = `^${version}`;
  }
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}
