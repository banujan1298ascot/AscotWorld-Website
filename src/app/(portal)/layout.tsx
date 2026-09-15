"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowClockwise,
  Bell,
  Moon,
  Prohibit,
  SignOut,
  Sun,
} from "@phosphor-icons/react/dist/ssr";
import { Logo, LogoMark } from "@/components/Logo";
import { PageTransition } from "@/components/PageTransition";
import { Avatar, Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useUnreadMessageCount } from "@/lib/messaging";
import { useUnreadNotificationCount } from "@/lib/notifications";
import { useDueTomorrowReminders } from "@/lib/reminders";
import { resetAllDemoData } from "@/lib/storage";
import { useTheme } from "@/lib/theme";
import { ROLES, type StaffMember } from "@/lib/types";
import {
  bottomNavForRole,
  canAccessModule,
  groupedModulesForRole,
  moduleForPath,
  type PortalModule,
} from "@/modules/registry";

/**
 * Unread counts for the two modules that carry a nav badge. Both hooks are
 * called unconditionally on every render, so this stays rules-of-hooks safe
 * no matter which module is being rendered — see the comment on
 * `badgeForModule` below before adding a third.
 */
function useModuleBadges(userId: string | undefined): Record<string, number> {
  const messages = useUnreadMessageCount(userId);
  const notifications = useUnreadNotificationCount(userId);
  return { messages, notifications };
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="tabular ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full
        bg-[var(--danger)] px-1 text-[10px] font-extrabold leading-none text-white"
      aria-hidden="true"
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Called unconditionally, ahead of the early return below, so hook order
  // stays fixed regardless of auth state — see the comment on the hook.
  const badges = useModuleBadges(user?.id);
  useDueTomorrowReminders(user?.id);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3">
          <LogoMark size={40} />
          <p className="text-sm text-[var(--muted-foreground)]">Checking your session…</p>
        </div>
      </div>
    );
  }

  const groups = groupedModulesForRole(user.role);
  const bottomNavModules = bottomNavForRole(user.role);
  const current = moduleForPath(pathname);

  // A section exists but this role may not open it — say so plainly rather
  // than silently redirecting somewhere unexpected.
  const forbidden = current ? !canAccessModule(current, user.role) : false;

  return (
    <div className="portal-ambient min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      {/* ================= Sidebar (desktop) ================= */}
      <aside
        className="sticky top-0 hidden h-dvh flex-col border-r border-[var(--glass-border)] backdrop-blur-xl lg:flex"
        style={{ background: "var(--glass-bg)" }}
      >
        <div className="px-4 py-4">
          <Link href="/dashboard" className="inline-block rounded" aria-label="AscotWorld portal home">
            <Logo size={24} descriptor="WORLD" />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-3" aria-label="Portal sections">
          {groups.map((group) => (
            <div key={group.group} className="mb-4">
              <p className="px-2 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--subtle-foreground)]">
                {group.label}
              </p>
              <ul className="grid gap-0.5">
                {group.modules.map((module) => (
                  <li key={module.id}>
                    <SidebarLink
                      module={module}
                      active={current?.id === module.id}
                      badge={badges[module.id] ?? 0}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <UserPanel user={user} onSignOut={signOut} />
      </aside>

      {/* ================= Main column ================= */}
      <div className="flex min-w-0 flex-col">
        <TopBar
          sectionLabel={current?.label ?? "Portal"}
          onSignOut={signOut}
          notificationCount={badges.notifications ?? 0}
        />

        <main className="flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-8">
          <PageTransition>
            {forbidden ? <Forbidden roleLabel={ROLES[user.role].label} /> : children}
          </PageTransition>
        </main>
      </div>

      {/* ================= Bottom nav (mobile) =================
          Capped at five destinations by `bottomNavForRole`. Notifications
          isn't one of them — it's reached via the bell icon in the top bar
          instead, which is present on every screen size. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t border-[var(--glass-border)]
          backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden"
        style={{
          gridTemplateColumns: `repeat(${bottomNavModules.length}, minmax(0, 1fr))`,
          background: "var(--glass-bg)",
        }}
        aria-label="Portal sections"
      >
        {bottomNavModules.map((module) => {
          const active = current?.id === module.id;
          const Icon = module.icon;
          const count = badges[module.id] ?? 0;
          return (
            <Link
              key={module.id}
              href={module.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 px-1 py-2
                text-[10px] font-bold transition-colors duration-150
                ${active ? "text-[var(--brand-600)]" : "text-[var(--muted-foreground)]"}`}
            >
              <span className="relative">
                <Icon size={20} weight={active ? "fill" : "regular"} />
                {count > 0 ? (
                  <span
                    className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-[var(--danger)]"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              <span className="truncate">{module.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SidebarLink({
  module,
  active,
  badge,
}: {
  module: PortalModule;
  active: boolean;
  badge: number;
}) {
  const Icon = module.icon;
  return (
    <Link
      href={module.href}
      title={module.description}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] font-semibold
        transition-[background-color,color,transform,box-shadow] duration-200
        ${
          active
            ? "text-white shadow-[var(--shadow-glow)]"
            : "text-[var(--muted-foreground)] hover:translate-x-0.5 hover:bg-[var(--surface-sunken)] hover:text-foreground"
        }`}
      style={active ? { background: "var(--brand-gradient)" } : undefined}
    >
      <Icon size={18} weight={active ? "fill" : "regular"} className="shrink-0" />
      {module.label}
      <NavBadge count={badge} />
    </Link>
  );
}

function TopBar({
  sectionLabel,
  onSignOut,
  notificationCount,
}: {
  sectionLabel: string;
  onSignOut: () => void;
  notificationCount: number;
}) {
  const { theme, toggle } = useTheme();
  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--glass-border)] px-4 py-2.5 backdrop-blur-xl sm:px-6"
      style={{ background: "var(--glass-bg)" }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          href="/dashboard"
          className="rounded lg:hidden"
          aria-label="AscotWorld portal home"
        >
          <Logo size={20} descriptor={null} />
        </Link>
        <span className="hidden text-[13px] font-bold text-[var(--muted-foreground)] lg:block">
          {sectionLabel}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Link
          href="/notifications"
          aria-label={
            notificationCount > 0
              ? `Notifications, ${notificationCount} unread`
              : "Notifications"
          }
          className="relative grid h-9 w-9 cursor-pointer place-items-center rounded-md text-[var(--muted-foreground)]
            transition-[background-color,color,transform,box-shadow] duration-200
            hover:-translate-y-0.5 hover:bg-[var(--surface-sunken)] hover:text-foreground hover:shadow-[var(--shadow-glow)]"
        >
          <Bell size={17} weight={notificationCount > 0 ? "fill" : "bold"} />
          {notificationCount > 0 ? (
            <span
              className="tabular absolute right-1 top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center
                rounded-full bg-[var(--danger)] px-0.5 text-[9px] font-extrabold leading-none text-white"
              aria-hidden="true"
            >
              {notificationCount > 9 ? "9+" : notificationCount}
            </span>
          ) : null}
        </Link>

        <button
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-md text-[var(--muted-foreground)]
            transition-[background-color,color,transform,box-shadow] duration-200
            hover:-translate-y-0.5 hover:bg-[var(--surface-sunken)] hover:text-foreground hover:shadow-[var(--shadow-glow)]"
        >
          <span
            className={`inline-flex transition-transform duration-300 ${theme === "dark" ? "rotate-180" : "rotate-0"}`}
          >
            {theme === "dark" ? <Sun size={17} weight="bold" /> : <Moon size={17} weight="bold" />}
          </span>
        </button>

        <button
          onClick={onSignOut}
          aria-label="Sign out"
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-md text-[var(--muted-foreground)]
            transition-[background-color,color,transform,box-shadow] duration-200
            hover:-translate-y-0.5 hover:bg-[var(--surface-sunken)] hover:text-foreground hover:shadow-[var(--shadow-glow)] lg:hidden"
        >
          <SignOut size={17} weight="bold" />
        </button>
      </div>
    </header>
  );
}

function UserPanel({ user, onSignOut }: { user: StaffMember; onSignOut: () => void }) {
  return (
    <div className="border-t border-[var(--border)] p-2.5">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
        <Avatar initials={user.initials} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-foreground">{user.name}</p>
          <p className="truncate text-[11px] text-[var(--muted-foreground)]">
            {ROLES[user.role].label}
          </p>
        </div>
      </div>

      <div className="mt-1 grid gap-0.5">
        <button
          onClick={() => {
            if (
              window.confirm(
                "Reset all demo data?\n\nThis clears every task, batch and rota change back to the original sample data. It cannot be undone.",
              )
            ) {
              resetAllDemoData();
            }
          }}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px]
            font-semibold text-[var(--muted-foreground)] transition-colors duration-150
            hover:bg-[var(--surface-sunken)] hover:text-foreground"
        >
          <ArrowClockwise size={15} weight="bold" />
          Reset demo data
        </button>

        {/* Sign out is kept visually separate from navigation. */}
        <button
          onClick={onSignOut}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px]
            font-semibold text-[var(--muted-foreground)] transition-colors duration-150
            hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
        >
          <SignOut size={15} weight="bold" />
          Sign out
        </button>
      </div>
    </div>
  );
}

function Forbidden({ roleLabel }: { roleLabel: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <Prohibit size={34} weight="duotone" className="text-[var(--muted-foreground)]" />
      <h1 className="mt-3 text-lg font-extrabold">This section isn&apos;t available to you</h1>
      <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">
        Your account is signed in as <strong className="text-foreground">{roleLabel}</strong>, which
        doesn&apos;t have access here. Ask an administrator if you need it.
      </p>
      <Link href="/dashboard" className="mt-5">
        <Button variant="primary">Back to dashboard</Button>
      </Link>
    </div>
  );
}
