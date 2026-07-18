// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Provider SDKs may only be imported inside src/adapters/** (domain rule 12:
// "Provider SDKs must not leak into domain or frontend code"). Grows as
// providers are adopted per docs/decisions/ADR-006-concrete-infrastructure.md.
const providerImportPatterns = [
  "ai",
  "ai/*",
  "@ai-sdk/*",
  "@vercel/blob",
  "@vercel/blob/*",
  "better-auth",
  "better-auth/*",
  "workflow",
  "workflow/*",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/adapters/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: providerImportPatterns,
              message:
                "Provider SDKs may only be imported inside src/adapters/ (domain rule 12). Depend on a Storylight port instead.",
            },
          ],
        },
      ],
    },
  }, // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  ...storybook.configs["flat/recommended"],
]);

export default eslintConfig;
