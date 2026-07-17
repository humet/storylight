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
});
