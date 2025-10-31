module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: null
  },
  plugins: ["@typescript-eslint", "import", "promise", "n"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:promise/recommended",
    "plugin:n/recommended",
    "prettier"
  ],
  env: {
    es2022: true,
    node: true
  },
  settings: {
    "import/resolver": {
      typescript: {}
    }
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "off"
  }
};
