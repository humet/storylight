/**
 * Drizzle schema barrel. `drizzle.config.ts` points here, and the Better Auth
 * Drizzle adapter is handed this whole namespace as its `schema` object
 * (see `src/adapters/auth/auth.ts`). Keep it export-only.
 */
export * from "./auth";
export * from "./families";
export * from "./characters";
export * from "./visual-assets";
export * from "./workflows";
