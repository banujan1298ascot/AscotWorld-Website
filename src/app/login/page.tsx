"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Buildings, ShieldCheck, Warning } from "@phosphor-icons/react/dist/ssr";
import { Logo } from "@/components/Logo";
import { Avatar, Button, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { staffCollection } from "@/lib/seed";
import { homeRouteFor } from "@/modules/registry";
import { ROLES, type Role } from "@/lib/types";

/** One representative account per role, for one-click demo sign-in. */
const DEMO_ROLE_ORDER: Role[] = ["admin", "production", "qa", "viewer"];

export default function LoginPage() {
  const { user, ready, signIn, signInAs } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Already signed in — don't show the form again. Station accounts land on
  // their own queue rather than the dashboard, hence homeRouteFor.
  useEffect(() => {
    if (ready && user) router.replace(homeRouteFor(user));
  }, [ready, user, router]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = signIn(email, password);
    if (!result.ok) setError(result.error);
    // On success the effect above routes, once the session is readable.
  }

  function quickSignIn(role: Role) {
    // Station accounts are listed separately below — a role shortcut should
    // land on the unrestricted account for that role, not a pinned station.
    const match = staffCollection.all().find((s) => s.role === role && s.mesStage == null);
    if (!match) return;
    signInAs(match.id);
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* ---------------------------------------------------------------- */}
      {/* Brand panel                                                       */}
      {/* ---------------------------------------------------------------- */}
      <section className="molecule-field relative hidden flex-col justify-between overflow-hidden bg-[var(--brand-950)] p-10 text-white lg:flex">
        <div
          className="absolute inset-0 opacity-90"
          style={{ background: "linear-gradient(150deg, #022166 0%, #01143d 60%, #010c26 100%)" }}
          aria-hidden="true"
        />
        <div className="molecule-field absolute inset-0" aria-hidden="true" />

        <div className="relative">
          <Logo size={38} descriptor="WORLD" className="[&_span]:!text-white" />
        </div>

        <div className="relative max-w-md">
          <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-[var(--brand-300)]">
            Staff portal
          </p>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.1] tracking-tight">
            Every batch, task and shift in one place.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">
            Plan production, track the work that supports it and see who is on shift —
            across the Borehamwood facility.
          </p>
        </div>

        <dl className="relative grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex items-start gap-2.5">
            <ShieldCheck size={20} weight="duotone" className="mt-0.5 shrink-0 text-[var(--brand-300)]" />
            <div>
              <dt className="font-bold">MHRA-approved site</dt>
              <dd className="text-white/60">Batch records with QA sign-off</dd>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <Buildings size={20} weight="duotone" className="mt-0.5 shrink-0 text-[var(--brand-300)]" />
            <div>
              <dt className="font-bold">Borehamwood, Herts</dt>
              <dd className="text-white/60">Human &amp; veterinary specials</dd>
            </div>
          </div>
        </dl>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Sign-in                                                           */}
      {/* ---------------------------------------------------------------- */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={32} descriptor="WORLD" />
          </div>

          <h2 className="text-2xl font-extrabold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Use your AscotWorld staff account to continue.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 grid gap-4" noValidate>
            <Field label="Email address" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                placeholder="name@ascotworld.example"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                required
              />
            </Field>

            <Field label="Password" htmlFor="password" required>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={error ? true : undefined}
                  className="pr-16"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded px-2 py-1
                    text-xs font-bold text-[var(--muted-foreground)] transition-colors duration-150
                    hover:text-foreground"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>

            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md bg-[var(--danger-bg)] px-3 py-2
                  text-xs font-semibold text-[var(--danger)]"
              >
                <Warning size={15} weight="fill" className="mt-px shrink-0" />
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="primary" icon={<ArrowRight size={16} weight="bold" />}>
              Sign in
            </Button>
          </form>

          {/* ---- demo shortcuts ---------------------------------------- */}
          <div className="mt-8 border-t border-[var(--border)] pt-6">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Demo accounts
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
              This is a demonstration build — sign in as any role to see what they can do.
              Every account uses the password{" "}
              <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5 font-bold text-foreground">
                demo1234
              </code>
              .
            </p>

            <div className="mt-3 grid gap-1.5">
              {DEMO_ROLE_ORDER.map((role) => {
                const person = staffCollection.all().find((s) => s.role === role);
                if (!person) return null;
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => quickSignIn(role)}
                    className="group flex cursor-pointer items-center gap-2.5 rounded-md border
                      border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-left
                      transition-colors duration-150 hover:border-[var(--brand-300)]
                      hover:bg-[var(--brand-50)]"
                  >
                    <Avatar initials={person.initials} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-foreground">
                        {person.name}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                        {ROLES[role].label}
                      </span>
                    </span>
                    <ArrowRight
                      size={14}
                      weight="bold"
                      className="shrink-0 text-[var(--subtle-foreground)] transition-colors
                        duration-150 group-hover:text-[var(--brand-500)]"
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- MES station logins ------------------------------------ */}
          <div className="mt-6 border-t border-[var(--border)] pt-6">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              MES stations
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
              One account per pipeline stage, as a tablet at that station would be signed in.
              Each one opens straight to its own queue and can&apos;t see the other stages.
            </p>

            <div className="mt-3 grid gap-1.5">
              {staffCollection
                .all()
                .filter((s) => s.mesStage != null)
                .sort((a, b) => (a.mesStage ?? 0) - (b.mesStage ?? 0))
                .map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => signInAs(person.id)}
                    className="group flex cursor-pointer items-center gap-2.5 rounded-md border
                      border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-left
                      transition-colors duration-150 hover:border-[var(--brand-300)]
                      hover:bg-[var(--brand-50)]"
                  >
                    <span
                      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full
                        text-[13px] font-extrabold text-white"
                      style={{ background: "var(--brand-gradient)" }}
                      aria-hidden="true"
                    >
                      {person.mesStage}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-foreground">
                        {person.jobTitle}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--muted-foreground)]">
                        {person.name} · {person.initials}
                      </span>
                    </span>
                    <ArrowRight
                      size={14}
                      weight="bold"
                      className="shrink-0 text-[var(--subtle-foreground)] transition-colors
                        duration-150 group-hover:text-[var(--brand-500)]"
                    />
                  </button>
                ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
