"use server";

import { redirect } from "next/navigation";
import {
  GENERIC_SIGN_IN_ERROR,
  type SignInState,
} from "@/app/actions/sign-in-state";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";

export async function signIn(
  _previousState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    email.trim().length === 0 ||
    typeof password !== "string" ||
    password.length === 0
  ) {
    return GENERIC_SIGN_IN_ERROR;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) return GENERIC_SIGN_IN_ERROR;
  } catch {
    return GENERIC_SIGN_IN_ERROR;
  }

  redirect("/");
}
