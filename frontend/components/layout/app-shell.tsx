"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as RadixDialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, Menu, X } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { NAV_SECTIONS, isActive, type NavItem } from "./nav-items";
import { useLogout, useSession } from "@/features/auth/use-session";
import { cn } from "@/lib/utils";

/**
 * The signed-in shell.
 *
 * A fixed sidebar on desktop and a drawer on mobile — not the same sidebar
 * squeezed narrow. Below `lg` the navigation is off-canvas and the content
 * takes the full width, because a permanently visible 15rem rail on a 375px
 * screen leaves nothing for the actual page.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  /*
   * The drawer closes when a nav link is tapped, not in an effect keyed on the
   * pathname.
   *
   * The effect version worked, but it set state during render-time reconciliation
   * and so triggered a second, cascading render on every navigation. Closing in
   * response to the actual user action is both cheaper and more honest about
   * what is happening — the drawer closes because it was used, not because the
   * URL happened to change.
   */
  const closeDrawer = React.useCallback(() => setMobileOpen(false), []);

  return (
    <div className="min-h-dvh">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[15rem] flex-col border-r border-border bg-surface lg:flex">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      <RadixDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink-950/25 lg:hidden data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <RadixDialog.Content
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-[16rem] flex-col border-r border-border bg-surface lg:hidden",
              "data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
            )}
            aria-label="Navigation"
          >
            {/* Radix requires an accessible title; it is redundant visually
                since the logo is right there, so it is visually hidden. */}
            <RadixDialog.Title className="sr-only">Navigation</RadixDialog.Title>
            <RadixDialog.Close className="absolute right-3 top-3.5 rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">Close navigation</span>
            </RadixDialog.Close>
            {/* Only the drawer copy dismisses on navigate. The desktop rail is
                always visible and has nothing to close. */}
            <SidebarContent onNavigate={closeDrawer} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className="lg:pl-[15rem]">
        {/* Mobile top bar. Sticky so navigation is always one tap away. */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur-sm lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="-ml-1.5 rounded-md p-1.5 text-ink-600 hover:bg-ink-100 hover:text-ink-900"
          >
            <Menu className="size-5" aria-hidden="true" />
            <span className="sr-only">Open navigation</span>
          </button>
          <Link href="/dashboard" aria-label="SocialPilot">
            <LogoMark className="size-6" />
          </Link>
        </header>

        <main id="main" className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[74rem]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <div className="px-3 pb-1 pt-4">
        <Link
          href="/dashboard"
          className="mb-3 inline-flex px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          aria-label="SocialPilot"
        >
          <Logo />
        </Link>
        <WorkspaceSwitcher />
      </div>

      {/* `nav` with a label, so a screen reader can jump straight here. */}
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section, index) => (
          <div key={section.label ?? `section-${index}`}>
            {section.label && (
              <h2 className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-ink-400">
                {section.label}
              </h2>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(pathname, item)} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <UserMenu />
      </div>
    </>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      // Dismisses the mobile drawer. Undefined on desktop, where there is
      // nothing to close.
      onClick={onNavigate}
      // The programmatic signal for "you are here". Colour alone would leave
      // this invisible to a screen reader.
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
        active
          ? "bg-accent-50 text-accent-700"
          : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", active ? "text-accent-600" : "text-ink-400")}
        aria-hidden="true"
      />
      {item.label}
    </Link>
  );
}

function UserMenu() {
  const { user } = useSession();
  const logout = useLogout();

  if (!user) return <div className="h-9 skeleton rounded-md" aria-hidden="true" />;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
            "hover:bg-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500",
            "data-[state=open]:bg-ink-100"
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-100 text-[10px] font-semibold text-accent-700"
          >
            {user.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink-900">{user.name}</span>
            <span className="block truncate text-[11px] text-ink-400">{user.email}</span>
          </span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="top"
          sideOffset={6}
          className="z-50 min-w-[13rem] rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          <DropdownMenu.Item asChild>
            <Link
              href="/settings"
              className="flex cursor-pointer items-center rounded-md px-2 py-1.5 text-[13px] text-ink-600 outline-none data-[highlighted]:bg-ink-100 data-[highlighted]:text-ink-900"
            >
              Account settings
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          <DropdownMenu.Item
            onSelect={() => logout.mutate()}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-600 outline-none data-[highlighted]:bg-danger-50 data-[highlighted]:text-danger-700"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
