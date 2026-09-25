import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const testingBan = {
  group: ["**/*.testing", "**/*.testing.ts"],
  message: "Test-only module. Allowed in *.test.ts, test/ and src/server/dev.ts only.",
};

const envBans = [
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message: "No process.env in this layer. Server config comes from config.ts; the browser gets BootConfig.",
  },
  {
    selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
    message: "No import.meta.env in the browser bundle. Runtime config arrives in BootConfig.",
  },
];

export default defineConfig(
  { ignores: ["dist/", "coverage/", "data/", "node_modules/", ".claude/"] },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/client/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts", "src/server/dev.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [testingBan] }] },
  },
  {
    files: ["src/client/**/*.{ts,tsx}", "src/shared/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...envBans],
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            testingBan,
            {
              group: ["**/server/**", "../server/*"],
              allowTypeImports: true,
              message: "The browser bundle must not import server modules (type-only imports are fine).",
            },
            { group: ["node:*"], message: "Shared and client code runs in the browser." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/main.ts", "src/server/dev.ts", "src/**/*.test.ts"],
    rules: { "no-restricted-syntax": ["error", envBans[0]] },
  },
);
