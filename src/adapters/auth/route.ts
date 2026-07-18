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
let cachedHandlers: Promise<ReturnType<typeof toNextJsHandler>> | undefined;

async function handlers(): Promise<ReturnType<typeof toNextJsHandler>> {
  cachedHandlers ??= getAuth().then((auth) => toNextJsHandler(auth));
  return cachedHandlers;
}

export async function GET(request: Request): Promise<Response> {
  return (await handlers()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return (await handlers()).POST(request);
}
