import type { Metadata, Viewport } from "next";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SocialPilot",
    template: "%s · SocialPilot",
  },
  description:
    "Automate your Instagram engagement. Reply to comments, send messages, and see exactly what ran.",
  // The product sits behind authentication and has nothing to index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Not capped, and user scaling left enabled. Locking zoom is a common
  // accessibility failure and buys nothing on a layout that is already
  // responsive.
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {/* First tabbable element on every page, so a keyboard user can get
            past the navigation without tabbing through all of it. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
