"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WorkspaceMembership } from "@/types";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useWorkspace } from "@/features/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, FieldInput, FieldLabel, FormError } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";

/**
 * Workspace selection.
 *
 * Radix's dropdown handles the parts that are easy to get wrong by hand:
 * focus trapping, typeahead, arrow-key roving, Escape, and returning focus to
 * the trigger on close. The audited system built its equivalent from a div and
 * a click-outside listener, which is keyboard-inaccessible.
 */
export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { workspaces, current, switchTo, switchingTo } = useWorkspace();
  const [creating, setCreating] = React.useState(false);

  if (!current) {
    return <div className="h-9 w-full skeleton rounded-md" aria-hidden="true" />;
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={cn(
              "group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
              "transition-colors hover:bg-ink-100",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
              "data-[state=open]:bg-ink-100"
            )}
            aria-label={`Current workspace: ${current.name}. Switch workspace`}
          >
            <WorkspaceAvatar name={current.name} />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink-900">
                    {current.name}
                  </span>
                </span>
                <ChevronsUpDown className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
              </>
            )}
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className={cn(
              "z-50 min-w-[15rem] rounded-lg border border-border bg-surface p-1 shadow-lg",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            )}
          >
            <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400">
              Workspaces
            </DropdownMenu.Label>

            {workspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                isCurrent={workspace.id === current.id}
                isSwitching={switchingTo === workspace.id}
                onSelect={() => switchTo(workspace.id)}
              />
            ))}

            <DropdownMenu.Separator className="my-1 h-px bg-border" />

            <DropdownMenu.Item
              onSelect={(event) => {
                // Radix closes the menu on select and would steal focus from
                // the dialog that is about to open.
                event.preventDefault();
                setCreating(true);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-600 outline-none data-[highlighted]:bg-ink-100 data-[highlighted]:text-ink-900"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New workspace
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function WorkspaceRow({
  workspace,
  isCurrent,
  isSwitching,
  onSelect,
}: {
  workspace: WorkspaceMembership;
  isCurrent: boolean;
  isSwitching: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 outline-none",
        "data-[highlighted]:bg-ink-100",
        isCurrent && "bg-accent-50 data-[highlighted]:bg-accent-50"
      )}
    >
      <WorkspaceAvatar name={workspace.name} />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-900">
          {workspace.name}
        </span>
        {/* A connection dot per workspace, so the switcher answers "which of
            these is actually set up?" without visiting each one. */}
        <span className="block truncate text-[11px] text-ink-400">
          {workspace.hasConnectedAccount ? "Instagram connected" : "Not connected"}
        </span>
      </span>

      {isSwitching ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-ink-400" aria-hidden="true" />
      ) : isCurrent ? (
        <Check className="size-3.5 shrink-0 text-accent-600" aria-hidden="true" />
      ) : null}
    </DropdownMenu.Item>
  );
}

/**
 * A generated monogram rather than a remote avatar service.
 *
 * The audited system fetched these from a third-party API, which put an
 * external network dependency in the navigation shell — the switcher would
 * render broken images whenever that service was slow or blocked.
 */
function WorkspaceAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-[5px] bg-ink-900 text-[10px] font-semibold text-white"
    >
      {initials || "W"}
    </span>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { switchTo } = useWorkspace();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const create = useMutation({
    mutationFn: (workspaceName: string) => api.workspaces.create({ name: workspaceName }),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      switchTo(data.workspace.id);
      onOpenChange(false);
      setName("");
    },
    onError: (mutationError) => setError(errorMessage(mutationError)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setName("");
          setError(null);
        }
      }}
      title="New workspace"
      description="Workspaces keep accounts, workflows, and activity separate."
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (name.trim()) create.mutate(name.trim());
        }}
        className="space-y-4"
      >
        {error && <FormError>{error}</FormError>}

        <Field>
          <FieldLabel>Name</FieldLabel>
          <FieldInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Second Brand"
            maxLength={60}
            autoFocus
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Create workspace
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
