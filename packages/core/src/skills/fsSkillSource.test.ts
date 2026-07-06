import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { FsSkillSource } from "./fsSkillSource";

async function makeSkillRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mh-skills-"));

  const review = path.join(root, "code-review");
  await mkdir(path.join(review, "checklists"), { recursive: true });
  await writeFile(
    path.join(review, "SKILL.md"),
    "# Code review\n\nReview changed files for correctness and safety.\n\n## Steps\n1. Read diff.",
  );
  await writeFile(
    path.join(review, "skill.meta.json"),
    JSON.stringify({ description: "Structured code review", tags: ["review"], risk: "low" }),
  );
  await writeFile(path.join(review, "checklists", "security.md"), "- injection\n- authz");

  const bare = path.join(root, "bare-skill");
  await mkdir(bare, { recursive: true });
  await writeFile(path.join(bare, "SKILL.md"), "# Bare\n\nMinimal skill without metadata.");

  // Directory without SKILL.md must be skipped by loadAll.
  await mkdir(path.join(root, "not-a-skill"), { recursive: true });

  return root;
}

test("load returns an executable skill with instructions and resources", async (t) => {
  const root = await makeSkillRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const source = new FsSkillSource({ rootDir: root });
  const skill = await source.load("code-review");

  assert.equal(skill.name, "code-review");
  assert.equal(skill.description, "Structured code review");
  assert.deepEqual(skill.tags, ["review"]);
  assert.equal(skill.risk, "low");

  const output = await skill.execute({});
  assert.equal(output.skill, "code-review");
  assert.match(String(output.instructions), /Review changed files/);
  assert.deepEqual(output.resources, [path.join("checklists", "security.md")]);
});

test("load derives description from SKILL.md when metadata is absent", async (t) => {
  const root = await makeSkillRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const source = new FsSkillSource({ rootDir: root });
  const skill = await source.load("bare-skill");
  assert.equal(skill.description, "Minimal skill without metadata.");

  const output = await skill.execute({});
  assert.equal(output.resources, undefined);
});

test("loadAll skips directories without SKILL.md and missing roots return empty", async (t) => {
  const root = await makeSkillRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const source = new FsSkillSource({ rootDir: root });
  const skills = await source.loadAll();
  assert.deepEqual(skills.map((s) => s.name).sort(), ["bare-skill", "code-review"]);

  const empty = new FsSkillSource({ rootDir: path.join(root, "does-not-exist") });
  assert.deepEqual(await empty.loadAll(), []);
});

test("load throws for a skill directory without SKILL.md", async (t) => {
  const root = await makeSkillRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  const source = new FsSkillSource({ rootDir: root });
  await assert.rejects(source.load("not-a-skill"), /has no SKILL.md/);
});
