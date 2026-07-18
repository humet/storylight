import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

// Domain rule 12: provider SDKs must not leak into domain or frontend code.
// These tests prove the ESLint boundary rule enforces that mechanically.
const eslint = new ESLint({ cwd: process.cwd() });

async function boundaryErrors(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

const providerImports = [
  'import { generateText } from "ai";',
  'import { anthropic } from "@ai-sdk/anthropic";',
  'import { put } from "@vercel/blob";',
  'import { betterAuth } from "better-auth";',
  'import { createWorkflow } from "workflow";',
];

describe("provider SDK import boundary", () => {
  it.each(providerImports)("rejects %s in src/domain", async (statement) => {
    const errors = await boundaryErrors(statement, "src/domain/fixture.ts");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects provider imports in React components", async () => {
    const errors = await boundaryErrors(
      'import { generateText } from "ai";',
      "src/components/fixture.tsx",
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("allows provider imports inside src/adapters", async () => {
    const errors = await boundaryErrors(
      'import { generateText } from "ai";',
      "src/adapters/ai/fixture.ts",
    );
    expect(errors).toHaveLength(0);
  });

  it("rejects provider imports inside src/db (db is not an adapter)", async () => {
    const errors = await boundaryErrors(
      'import { betterAuth } from "better-auth";',
      "src/db/fixture.ts",
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

// M2: Drizzle/DB drivers may only be imported inside src/db/** and
// src/adapters/** (ADR-005/006). Everything else depends on a repository port.
const databaseImports = [
  'import { drizzle } from "drizzle-orm/node-postgres";',
  'import { eq } from "drizzle-orm";',
  'import { Pool } from "pg";',
  'import { PGlite } from "@electric-sql/pglite";',
];

describe("database driver import boundary", () => {
  it.each(databaseImports)("rejects %s in src/domain", async (statement) => {
    const errors = await boundaryErrors(statement, "src/domain/fixture.ts");
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each(databaseImports)(
    "rejects %s in src/application",
    async (statement) => {
      const errors = await boundaryErrors(
        statement,
        "src/application/fixture.ts",
      );
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it("rejects DB drivers in React components", async () => {
    const errors = await boundaryErrors(
      'import { Pool } from "pg";',
      "src/components/fixture.tsx",
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each(databaseImports)("allows %s inside src/db", async (statement) => {
    const errors = await boundaryErrors(statement, "src/db/fixture.ts");
    expect(errors).toHaveLength(0);
  });

  it("allows DB drivers inside src/adapters", async () => {
    const errors = await boundaryErrors(
      'import { drizzle } from "drizzle-orm/node-postgres";',
      "src/adapters/auth/fixture.ts",
    );
    expect(errors).toHaveLength(0);
  });
});
