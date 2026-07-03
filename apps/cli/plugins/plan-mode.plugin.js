const { PlanModePlugin } = require("@micro-harness/plugin-plan-mode");

module.exports = new PlanModePlugin({
  rootDir: process.cwd(),
  maxExploreFiles: 30,
  maxDepth: 6
});
