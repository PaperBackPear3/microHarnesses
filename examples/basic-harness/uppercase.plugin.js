module.exports = {
  name: "uppercase-plugin",
  register(api) {
    api.registerTool({
      name: "upper",
      description: "Uppercases input text.",
      async execute(input) {
        return { text: String(input.text || "").toUpperCase() };
      }
    });
  }
};
