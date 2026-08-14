"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  changePasswordRequestSchema,
  updateProfileRequestSchema,
  updateWorkspaceRequestSchema,
  type ChangePasswordRequest,
  type UpdateProfileRequest,
  type UpdateWorkspaceRequest,
} from "@/types";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldInput, FieldLabel, FormError } from "@/components/ui/field";
import { api, errorMessage, toFormErrors } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useSession } from "@/features/auth/use-session";
import { useWorkspace, useWorkspaceId } from "@/features/workspace/workspace-provider";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Your profile, password, and workspace." />

      <div className="space-y-5">
        <ProfileCard />
        <WorkspaceCard />
        <PasswordCard />
      </div>
    </>
  );
}

/** A small status line beside a submit button, so a save is visibly confirmed. */
function SaveStatus({ saved, error }: { saved: boolean; error: string | null }) {
  if (error) {
    return (
      <span role="alert" className="text-[13px] text-danger-600">
        {error}
      </span>
    );
  }
  if (saved) {
    return (
      <span role="status" className="text-[13px] text-success-600">
        Saved
      </span>
    );
  }
  return null;
}

function ProfileCard() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [saved, setSaved] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<UpdateProfileRequest>({
    resolver: zodResolver(updateProfileRequestSchema),
    values: { name: user?.name ?? "" },
  });

  const update = useMutation({
    mutationFn: (input: UpdateProfileRequest) => api.auth.updateProfile(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <form
        onSubmit={handleSubmit(async (values) => {
          try {
            await update.mutateAsync(values);
            reset(values);
          } catch (error) {
            const fields = toFormErrors(error);
            if (fields?.name) setError("name", fields.name);
            else setError("root", { message: errorMessage(error) });
          }
        })}
      >
        <CardContent className="max-w-sm space-y-4">
          {errors.root && <FormError>{errors.root.message}</FormError>}

          <Field error={errors.name?.message}>
            <FieldLabel>Name</FieldLabel>
            <FieldInput {...register("name")} />
          </Field>

          <Field>
            <FieldLabel>Email</FieldLabel>
            {/* Read-only: changing an email is an identity change that needs a
                verification flow, and offering an editable field that silently
                does nothing would be worse than not offering one. */}
            <FieldInput value={user?.email ?? ""} readOnly disabled />
            <FieldDescription>Contact support to change your email address.</FieldDescription>
          </Field>
        </CardContent>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-ink-50/50 px-5 py-3">
          <SaveStatus saved={saved} error={null} />
          <Button type="submit" size="sm" loading={update.isPending} disabled={!isDirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function WorkspaceCard() {
  const { current } = useWorkspace();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const [saved, setSaved] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<UpdateWorkspaceRequest>({
    resolver: zodResolver(updateWorkspaceRequestSchema),
    values: { name: current?.name ?? "" },
  });

  const update = useMutation({
    mutationFn: (input: UpdateWorkspaceRequest) => api.workspaces.update(input, workspaceId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Workspace</CardTitle>
          <p className="mt-0.5 text-[13px] text-ink-500">
            Workspaces keep accounts, workflows, and activity separate.
          </p>
        </div>
      </CardHeader>
      <form
        onSubmit={handleSubmit(async (values) => {
          try {
            await update.mutateAsync(values);
            reset(values);
          } catch (error) {
            const fields = toFormErrors(error);
            if (fields?.name) setError("name", fields.name);
            else setError("root", { message: errorMessage(error) });
          }
        })}
      >
        <CardContent className="max-w-sm space-y-4">
          {errors.root && <FormError>{errors.root.message}</FormError>}

          <Field error={errors.name?.message}>
            <FieldLabel>Workspace name</FieldLabel>
            <FieldInput {...register("name")} />
          </Field>

          {current && (
            <Field>
              <FieldLabel>Identifier</FieldLabel>
              {/* Derived server-side from the name and never client-supplied —
                  a slug is a namespace, and letting a caller pick one lets them
                  squat it. */}
              <FieldInput value={current.slug} readOnly disabled />
              <FieldDescription>Generated from the name. Not editable.</FieldDescription>
            </Field>
          )}
        </CardContent>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-ink-50/50 px-5 py-3">
          <SaveStatus saved={saved} error={null} />
          <Button type="submit" size="sm" loading={update.isPending} disabled={!isDirty}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const [saved, setSaved] = React.useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ChangePasswordRequest>({
    resolver: zodResolver(changePasswordRequestSchema),
    defaultValues: { currentPassword: "", newPassword: "" },
  });

  const change = useMutation({
    mutationFn: (input: ChangePasswordRequest) => api.auth.changePassword(input),
    onSuccess: () => {
      reset();
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Password</CardTitle>
          <p className="mt-0.5 text-[13px] text-ink-500">
            Changing your password signs you out everywhere else.
          </p>
        </div>
      </CardHeader>
      <form
        onSubmit={handleSubmit(async (values) => {
          try {
            await change.mutateAsync(values);
          } catch (error) {
            const fields = toFormErrors(error);
            if (fields) {
              for (const [path, detail] of Object.entries(fields)) {
                setError(path as keyof ChangePasswordRequest, detail);
              }
              return;
            }
            setError("root", { message: errorMessage(error) });
          }
        })}
      >
        <CardContent className="max-w-sm space-y-4">
          {errors.root && <FormError>{errors.root.message}</FormError>}

          <Field error={errors.currentPassword?.message}>
            <FieldLabel>Current password</FieldLabel>
            <FieldInput type="password" autoComplete="current-password" {...register("currentPassword")} />
          </Field>

          <Field error={errors.newPassword?.message}>
            <FieldLabel>New password</FieldLabel>
            <FieldInput type="password" autoComplete="new-password" {...register("newPassword")} />
            <FieldDescription>At least 8 characters. Longer is better than complex.</FieldDescription>
          </Field>
        </CardContent>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-ink-50/50 px-5 py-3">
          {saved && (
            <span role="status" className="text-[13px] text-success-600">
              Password changed. Other sessions signed out.
            </span>
          )}
          <Button type="submit" size="sm" loading={change.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
