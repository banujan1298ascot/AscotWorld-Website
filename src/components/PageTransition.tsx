"use client";

import { usePathname } from "next/navigation";

/**
 * Replays a fade/rise-in animation whenever the route changes. Keying the
 * wrapper by pathname remounts it on navigation, which restarts the CSS
 * animation without any transition library.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-fade-in-up">
      {children}
    </div>
  );
}
