import Link from "next/link";
import { Logo } from "@/components/brand/logo";

/**
 * The signed-out shell.
 *
 * A single centred column on a plain canvas. No marketing split-screen, no
 * illustration — this is a tool people sign into daily, and the fastest path
 * from arrival to the password field is the whole design goal.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-6 sm:px-10">
        <Link
          href="/login"
          className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-500"
          aria-label="SocialPilot"
        >
          <Logo />
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-start justify-center px-6 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>

      <footer className="px-6 py-6 text-center text-[13px] text-ink-400 sm:px-10">
        Instagram automation, with a record of everything it did.
      </footer>
    </div>
  );
}
