"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginRequestSchema, type LoginRequest } from "@socialpilot/contracts";
import { Button } from "@/components/ui/button";
import { Field, FieldInput, FieldLabel, FormError } from "@/components/ui/field";
import { useLogin } from "@/features/auth/use-session";
import { ApiClientError, errorMessage, toFormErrors } from "@/lib/api-client";

export default function LoginPage() {
  const login = useLogin();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    // The same schema the API validates against. The client copy exists to
    // save a round trip, not to be trusted — the server is the real gate.
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginRequest) {
    try {
      await login.mutateAsync(values);
    } catch (error) {
      // Field-level failures land on the input that caused them; anything else
      // becomes a form-wide message rather than being silently swallowed.
      const fields = toFormErrors(error);
      if (fields) {
        for (const [path, detail] of Object.entries(fields)) {
          setError(path as keyof LoginRequest, detail);
        }
        return;
      }

      setError("root", {
        message:
          error instanceof ApiClientError && error.isAuthError
            ? "That email or password is not correct."
            : errorMessage(error),
      });
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink-900">Sign in</h1>
      <p className="mt-1.5 text-sm text-ink-500">
        Welcome back. Enter your details to continue.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        {errors.root && <FormError>{errors.root.message}</FormError>}

        <Field error={errors.email?.message}>
          <FieldLabel>Email</FieldLabel>
          <FieldInput
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            {...register("email")}
          />
        </Field>

        <Field error={errors.password?.message}>
          <FieldLabel>Password</FieldLabel>
          <FieldInput
            type="password"
            // `current-password`, not `password` — this is what lets a password
            // manager offer the saved credential rather than a new one.
            autoComplete="current-password"
            placeholder="••••••••"
            {...register("password")}
          />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting || login.isPending}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-ink-500">
        New here?{" "}
        <Link
          href="/signup"
          className="font-medium text-ink-900 underline underline-offset-4 hover:no-underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
