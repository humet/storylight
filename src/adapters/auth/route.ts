import "server-only";

import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "./auth";

/**
 * Lazily-built Next.js route handlers for Better Auth's catch-all endpoint.
 *
 * The API route file (`src/app/api/auth/[...all]/route.ts`) re-exports these —
 * it may not import Better Auth directly (ESLint boundary). Handlers are built
 * on first request, never at import time, so `pnpm build` (no env vars) never
 * instantiates the auth provider.
 */
let cachedHandlers: ReturnType<typeof toNextJsHandler> | undefined;

function handlers(): ReturnType<typeof toNextJsHandler> {
  cachedHandlers ??= toNextJsHandler(getAuth());
  return cachedHandlers;
}

export function GET(request: Request): Promise<Response> {
  return handlers().GET(request);
}

export function POST(request: Request): Promise<Response> {
  return handlers().POST(request);
}
