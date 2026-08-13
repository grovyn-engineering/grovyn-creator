import { cn } from "@/lib/utils";

/**
 * The mark: a rounded square holding a stylised flight path.
 *
 * Inline SVG rather than an image file so it inherits colour from CSS, stays
 * crisp at any size, and costs no network request. Branding lives in this one
 * component, which is also what makes renaming the product a contained change.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7", className)}
      role="presentation"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" className="fill-ink-900" />
      {/* An ascending path with a node at each end: a route, and the two ends
          of an automation — the event and the action. */}
      <path
        d="M9 21.5 L23 10.5"
        className="stroke-white"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="9" cy="21.5" r="2.75" className="fill-white" />
      <circle cx="23" cy="10.5" r="2.75" className="fill-accent-400" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink-900">
        SocialPilot
      </span>
    </span>
  );
}
