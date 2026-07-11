import assert from "node:assert/strict";
import test from "node:test";
import { SkillRegistry } from "../../skills/registry";
import { createFindSkillTool } from "./findSkillTool";
import { createListSkillsTool } from "./listSkillsTool";
import { createSkillTool } from "./skillTool";

function makeSkills(): SkillRegistry {
  const skills = new SkillRegistry();
  skills.register({
    name: "create-mcp-app",
    description: "Builds MCP apps",
    tags: ["mcp", "apps"],
    capabilities: ["ui"],
    async execute() {
      return { created: true };
    },
  });
  skills.register({
    name: "aws-iam",
    description: "IAM guidance",
    tags: ["aws", "security"],
    capabilities: ["policy"],
    async execute() {
      return { audited: true };
    },
  });
  return skills;
}

test("list_skills returns filtered skill summaries", async () => {
  const tool = createListSkillsTool(makeSkills());
  const result = await tool.execute({ tag: "mcp" });
  assert.equal(result.total, 1);
  const listed = result.skills as Array<{ name: string }>;
  assert.deepEqual(listed.map((item) => item.name), ["create-mcp-app"]);
});

test("find_skill matches by text across skill metadata", async () => {
  const tool = createFindSkillTool(makeSkills());
  const result = await tool.execute({ query: "security" });
  assert.equal(result.total, 1);
  const listed = result.skills as Array<{ name: string }>;
  assert.equal(listed[0]?.name, "aws-iam");
});

test("skill executes a selected skill and forwards output", async () => {
  const tool = createSkillTool(makeSkills());
  const result = await tool.execute({ name: "create-mcp-app", input: { repo: "demo" } });
  assert.deepEqual(result, { created: true });
});

test("skill throws for unknown skill names", async () => {
  const tool = createSkillTool(makeSkills());
  await assert.rejects(tool.execute({ name: "missing-skill" }), /Unknown skill/);
});
