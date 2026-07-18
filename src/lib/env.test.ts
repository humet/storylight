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

describe("safe-by-default NODE_ENV (review finding 2026-07-18)", () => {
  it("treats an UNSET NODE_ENV as production so insecure fallbacks cannot activate by omission", async () => {
    const { isDevLikeEnv } = await import("./env");
    const withoutNodeEnv = { ...process.env };
    Reflect.deleteProperty(withoutNodeEnv, "NODE_ENV");
    process.env = withoutNodeEnv;
    resetEnvCacheForTests();

    const env = getEnv();
    expect(env.NODE_ENV).toBe("production");
    expect(isDevLikeEnv(env)).toBe(false);
  });

  it("isDevLikeEnv requires an explicit development or test value", async () => {
    const { isDevLikeEnv } = await import("./env");
    expect(isDevLikeEnv({ NODE_ENV: "development" } as never)).toBe(true);
    expect(isDevLikeEnv({ NODE_ENV: "test" } as never)).toBe(true);
    expect(isDevLikeEnv({ NODE_ENV: "production" } as never)).toBe(false);
  });
});
