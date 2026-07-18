import { afterEach, describe, expect, it } from "vitest";
import { getEnv, requireEnv, resetEnvCacheForTests } from "./env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetEnvCacheForTests();
});

describe("env validation", () => {
  it("parses lazily and tolerates a bare environment", () => {
    delete process.env.DATABASE_URL;
    delete process.env.BETTER_AUTH_SECRET;
    resetEnvCacheForTests();

    const env = getEnv();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    // NODE_ENV always resolves to a known value.
    expect(["development", "test", "production"]).toContain(env.NODE_ENV);
  });

  it("rejects a malformed value that IS present", () => {
    process.env.DATABASE_URL = "not-a-url";
    resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/Invalid environment configuration/);
  });

  it("requireEnv throws a readable error when a value is absent", () => {
    delete process.env.BETTER_AUTH_SECRET;
    resetEnvCacheForTests();
    expect(() => requireEnv("BETTER_AUTH_SECRET")).toThrow(
      /Missing required environment variable BETTER_AUTH_SECRET/,
    );
  });
});
