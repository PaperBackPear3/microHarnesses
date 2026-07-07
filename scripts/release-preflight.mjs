#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const packageDirs = process.argv.slice(2);
if (packageDirs.length === 0) {
  process.stderr.write(
    "Usage: node scripts/release-preflight.mjs <package-dir> [<package-dir>...]\n",
  );
  process.exit(1);
}

const repoRoot = process.cwd();
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const expectedRepositoryUrl = normalizeRepositoryUrl(
  readRepositoryUrl(rootPackage, "package.json"),
);
const packageSummaries = packageDirs.map((dir) => readAndValidatePackage(dir));
const releaseVersion = assertSingleVersion(packageSummaries);

for (const summary of packageSummaries) {
  assertInternalDependencyRanges(summary, releaseVersion);
}

const tagVersion = readTagVersion();
if (tagVersion && tagVersion !== releaseVersion) {
  fail(`Tag version (${tagVersion}) does not match package version (${releaseVersion}).`);
}

for (const summary of packageSummaries) {
  assertVersionNotPublished(summary.name, releaseVersion);
}

process.stdout.write(
  `Release preflight passed for ${packageSummaries.length} packages at version ${releaseVersion}.\n`,
);

function readAndValidatePackage(relativeDir) {
  const packageJsonPath = path.join(repoRoot, relativeDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    fail(`Missing package.json at ${relativeDir}/package.json`);
  }

  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const name = parsed.name;
  const version = parsed.version;

  if (typeof name !== "string" || !name.startsWith("@micro-harnesses/")) {
    fail(`Invalid package name in ${relativeDir}/package.json: ${String(name)}`);
  }

  if (typeof version !== "string" || !isSemver(version)) {
    fail(`Invalid semver version in ${relativeDir}/package.json: ${String(version)}`);
  }
  const repositoryUrl = normalizeRepositoryUrl(
    readRepositoryUrl(parsed, `${relativeDir}/package.json`),
  );
  if (repositoryUrl !== expectedRepositoryUrl) {
    fail(
      `Repository URL mismatch in ${relativeDir}/package.json: ${repositoryUrl} does not match ${expectedRepositoryUrl}`,
    );
  }

  return {
    dir: relativeDir,
    name,
    version,
    dependencies: parsed.dependencies ?? {},
    devDependencies: parsed.devDependencies ?? {},
    peerDependencies: parsed.peerDependencies ?? {},
    optionalDependencies: parsed.optionalDependencies ?? {},
  };
}

function assertSingleVersion(packages) {
  const versions = new Set(packages.map((pkg) => pkg.version));
  if (versions.size !== 1) {
    const details = packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(", ");
    fail(`Publishable packages have mismatched versions: ${details}`);
  }

  return packages[0].version;
}

function assertInternalDependencyRanges(pkg, releaseVersion) {
  const expected = `^${releaseVersion}`;
  for (const dependencySet of [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
    pkg.optionalDependencies,
  ]) {
    for (const [name, range] of Object.entries(dependencySet)) {
      if (!name.startsWith("@micro-harnesses/")) {
        continue;
      }

      if (range !== expected) {
        fail(
          `Internal dependency mismatch in ${pkg.dir}/package.json: ${name} is ${String(
            range,
          )}, expected ${expected}`,
        );
      }
    }
  }
}

function readTagVersion() {
  const ref = process.env.GITHUB_REF ?? "";
  const match = ref.match(/^refs\/tags\/v(.+)$/);
  return match ? match[1] : null;
}

function assertVersionNotPublished(packageName, version) {
  const lookup = spawnSync("npm", ["view", `${packageName}@${version}`, "version"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (lookup.status === 0) {
    fail(
      `Version already exists on npm: ${packageName}@${version}. Bump versions before publishing.`,
    );
  }

  const output = `${lookup.stdout ?? ""}${lookup.stderr ?? ""}`;
  if (!/E404|404 Not Found|No match found/i.test(output)) {
    fail(`Unable to verify npm publishability for ${packageName}@${version}: ${output.trim()}`);
  }
}

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function readRepositoryUrl(pkg, source) {
  const repository = pkg.repository;
  const url =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object"
        ? repository.url
        : undefined;
  if (typeof url !== "string" || url.trim().length === 0) {
    fail(`Missing repository.url in ${source}`);
  }
  return url.trim();
}

function normalizeRepositoryUrl(url) {
  return url.replace(/\.git$/i, "").replace(/\/+$/g, "");
}

function fail(message) {
  process.stderr.write(`release-preflight: ${message}\n`);
  process.exit(1);
}
