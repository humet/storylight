"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  signInWithPassword,
  signUpWithPassword,
  signOutCurrentSession,
} from "@/adapters/auth/passwords";
import { isDomainError } from "@/lib/errors";

/**
 * Thin command adapters for the credential forms (`docs/05-backend/api.md`
 * "Server Actions"): validate input, call the auth adapter, redirect. No
 * orchestration logic lives here. On failure they redirect back with a generic
 * `?error` flag — never a provider message — so the form can re-render safely
 * with no client-side JavaScript.
 *
 * `redirect()` is always called OUTSIDE the try block: it works by throwing an
 * internal control-flow signal that a `catch` must not swallow.
 */

const SignInSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const SignUpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(128),
});

export async function signInAction(formData: FormData): Promise<void> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect("/sign-in?error=invalid");
  }

  try {
    await signInWithPassword(parsed.data);
  } catch (error) {
    if (isDomainError(error)) {
      redirect("/sign-in?error=invalid");
    }
    throw error;
  }

  redirect("/app");
}

export async function signUpAction(formData: FormData): Promise<void> {
  const parsed = SignUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect("/sign-up?error=invalid");
  }

  try {
    await signUpWithPassword(parsed.data);
  } catch (error) {
    if (isDomainError(error)) {
      redirect("/sign-up?error=taken");
    }
    throw error;
  }

  redirect("/app");
}

export async function signOutAction(): Promise<void> {
  await signOutCurrentSession();
  redirect("/");
}
