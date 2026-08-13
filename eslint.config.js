import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "action/dist/**",
      "coverage/**",
      "node_modules/**",
      "demo/**",
      "research/**",
      "eslint.config.js",
      "vitest.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.check.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/mcp/server.ts"],
    rules: { "@typescript-eslint/require-await": "off" },
  },
);
