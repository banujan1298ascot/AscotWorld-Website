"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { LogoMark } from "@/components/Logo";

/** Sends people to the portal if they have a session, or to sign-in if not. */
export default function RootPage() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [ready, user, router]);

  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-3">
        <LogoMark size={40} />
        <p className="text-sm text-[var(--muted-foreground)]">Loading portal…</p>
      </div>
    </div>
  );
}
