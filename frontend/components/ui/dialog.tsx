"use client";

import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal dialog.
 *
 * Built on Radix rather than a raw `<div>` overlay because correct dialog
 * behaviour is a long list that is easy to half-implement: focus moves into the
 * dialog on open and returns to the trigger on close, focus is trapped while
 * open, Escape closes it, the background is inert to both pointer and screen
 * reader, and the title is announced. Every one of those is an accessibility
 * requirement, and hand-rolled modals typically satisfy two or three.
 *
 * `title` is required rather than optional — a dialog with no accessible name
 * is announced as just "dialog", which tells a screen-reader user nothing.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-ink-950/25",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          )}
        />
        <RadixDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
            "rounded-xl border border-border bg-surface p-5 shadow-lg",
            // Tall content scrolls inside the dialog rather than pushing it off
            // the viewport, where its actions become unreachable on a laptop.
            "max-h-[calc(100dvh-4rem)] overflow-y-auto",
            size === "md" ? "sm:max-w-[26rem]" : "sm:max-w-[36rem]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          )}
        >
          <div className="mb-4 pr-8">
            <RadixDialog.Title className="text-[15px] font-semibold text-ink-900">
              {title}
            </RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="mt-1 text-[13px] leading-5 text-ink-500">
                {description}
              </RadixDialog.Description>
            )}
          </div>

          <RadixDialog.Close
            className={cn(
              "absolute right-4 top-4 rounded-md p-1 text-ink-400 transition-colors",
              "hover:bg-ink-100 hover:text-ink-700",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            )}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close</span>
          </RadixDialog.Close>

          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
