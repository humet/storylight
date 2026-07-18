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

// Database driver + ORM packages may only be imported inside src/db/** (the
// single DB entry point, schema, migrations, repositories) and src/adapters/**
// (the Better Auth adapter persists through the same db). Everything else
// depends on the repository ports in src/application/, never on Drizzle rows or
// a raw driver. ADR-005/006; M2 boundary.
const databaseImportPatterns = [
  "drizzle-orm",
  "drizzle-orm/*",
  "pg",
  "@electric-sql/pglite",
];

const providerRestriction = {
  group: providerImportPatterns,
  message:
    "Provider SDKs may only be imported inside src/adapters/ (domain rule 12). Depend on a Storylight port instead.",
};

const databaseRestriction = {
  group: databaseImportPatterns,
  message:
    "Drizzle/DB drivers may only be imported inside src/db/ or src/adapters/. Depend on a repository port (src/application/ports) instead.",
};

// ESLint flat config merges rules by "last object wins" for any file a config
// object matches, so the two boundaries are expressed as NON-overlapping file
// regions rather than two objects both matching src/**:
//   - src/adapters/**  → no restriction (the only place providers + drivers live)
//   - src/db/**        → drivers allowed, providers still forbidden
//   - everything else  → both forbidden (domain, application, components, lib)
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Non-adapter, non-db code: neither provider SDKs nor DB drivers.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/adapters/**", "src/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [providerRestriction, databaseRestriction] },
      ],
    },
  },
  {
    // The DB layer may use Drizzle/drivers, but never a provider SDK.
    files: ["src/db/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [providerRestriction] }],
    },
  }, // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build artifacts (gitignored) that ESLint's flat config does not skip on
    // its own.
    "storybook-static/**",
    "drizzle/**",
  ]),
  ...storybook.configs["flat/recommended"],
]);

export default eslintConfig;
