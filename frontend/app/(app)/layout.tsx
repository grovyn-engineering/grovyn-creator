import { WorkspaceProvider } from "@/features/workspace/workspace-provider";
import { AppShell } from "@/components/layout/app-shell";

/**
 * Every signed-in route lives under this layout, so the workspace context is
 * resolved once for the whole application rather than per page. Middleware has
 * already redirected anyone without a session cookie.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
