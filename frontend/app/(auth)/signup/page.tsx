"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signupRequestSchema, type SignupRequest } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldInput,
  FieldLabel,
  FormError,
} from "@/components/ui/field";
import { useSignup } from "@/features/auth/use-session";
import { errorMessage, toFormErrors } from "@/lib/api";

export default function SignupPage() {
  const signup = useSignup();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupRequest>({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { name: "", email: "", password: "", workspaceName: "" },
  });

  async function onSubmit(values: SignupRequest) {
    try {
      await signup.mutateAsync({
        ...values,
        // Empty means "use the default" rather than "name it the empty string".
        workspaceName: values.workspaceName?.trim() || undefined,
      });
    } catch (error) {
      const fields = toFormErrors(error);
      if (fields) {
        for (const [path, detail] of Object.entries(fields)) {
          setError(path as keyof SignupRequest, detail);
        }
        return;
      }
      setError("root", { message: errorMessage(error) });
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink-900">Create your account</h1>
      <p className="mt-1.5 text-sm text-ink-500">
        Set up a workspace and connect Instagram in a couple of minutes.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        {errors.root && <FormError>{errors.root.message}</FormError>}

        <Field error={errors.name?.message}>
          <FieldLabel>Name</FieldLabel>
          <FieldInput autoComplete="name" autoFocus placeholder="Alex Morgan" {...register("name")} />
        </Field>

        <Field error={errors.email?.message}>
          <FieldLabel>Email</FieldLabel>
          <FieldInput
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            {...register("email")}
          />
        </Field>

        <Field error={errors.password?.message}>
          <FieldLabel>Password</FieldLabel>
          <FieldInput
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            {...register("password")}
          />
          {/*
            Length is the only rule, deliberately. Composition requirements push
            people toward predictable substitutions without adding entropy, and
            NIST has recommended against them since 2017.
          */}
          <FieldDescription>Use at least 8 characters. Longer is better than complex.</FieldDescription>
        </Field>

        <Field error={errors.workspaceName?.message}>
          <FieldLabel optional>Workspace name</FieldLabel>
          <FieldInput placeholder="Morgan Studio" {...register("workspaceName")} />
          <FieldDescription>Leave blank and we&rsquo;ll name it after you.</FieldDescription>
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting || signup.isPending}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-ink-500">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-ink-900 underline underline-offset-4 hover:no-underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
