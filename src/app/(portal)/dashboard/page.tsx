"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { format, subDays } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  ChartLineUp,
  ClipboardText,
  Factory,
  TestTube,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import {
  BatchStatusPill,
  DueDate,
  PriorityTag,
  ProductLineTag,
  StaffStack,
  TaskStatusPill,
} from "@/components/domain";
import { Card, EmptyState, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { batchCollection, staffCollection, taskCollection } from "@/lib/seed";
import { conflictedBatchIds, resourceById } from "@/lib/schedule";
import { useCollection } from "@/lib/storage";
import { MODULES } from "@/modules/registry";
import { canAccessModule } from "@/modules/registry";

export default function DashboardPage() {
  const { user } = useAuth();
  const { items: batches, ready } = useCollection(batchCollection);
  const { items: tasks } = useCollection(taskCollection);
  const { items: staff } = useCollection(staffCollection);

  const today = format(new Date(), "yyyy-MM-dd");
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const runningToday = useMemo(
    () =>
      batches
        .filter((b) => b.startDate <= today && b.endDate >= today && b.status !== "cancelled")
        .sort((a, b) => a.batchNo.localeCompare(b.batchNo)),
    [batches, today],
  );

  const myTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.assigneeId === user?.id && t.status !== "done")
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")),
    [tasks, user],
  );

  const stats = useMemo(() => {
    const overdue = tasks.filter(
      (t) => t.status !== "done" && t.dueDate && t.dueDate < today,
    ).length;
    const openTasks = tasks.filter((t) => t.status !== "done").length;
    return [
      {
        id: "production",
        label: "In production",
        value: batches.filter((b) => b.status === "in_production").length,
        href: "/schedule",
        tone: "var(--status-production)",
        caption: "batches running now",
        icon: <Factory size={20} weight="fill" />,
      },
      {
        id: "qa",
        label: "On QA hold",
        value: batches.filter((b) => b.status === "qa_hold").length,
        href: "/schedule",
        tone: "var(--status-qa)",
        caption: "awaiting release",
        icon: <TestTube size={20} weight="fill" />,
      },
      {
        id: "open",
        label: "Open tasks",
        value: openTasks,
        href: "/tasks",
        tone: "var(--muted-foreground)",
        caption: "across the team",
        icon: <ClipboardText size={20} weight="fill" />,
      },
      {
        id: "overdue",
        label: "Overdue tasks",
        value: overdue,
        href: "/tasks",
        tone: overdue > 0 ? "var(--danger)" : "var(--muted-foreground)",
        caption: overdue > 0 ? "need attention" : "none right now",
        icon: <Warning size={20} weight="fill" />,
      },
    ];
  }, [batches, tasks, today]);

  // Real data, not a placeholder: how many tasks were created each of the
  // last 7 days, from Task.createdAt — no historical snapshot is stored, so
  // this is the one series in the seed data with enough day-to-day variety
  // to animate meaningfully.
  const taskTrend = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => subDays(new Date(), 6 - i)).map((day) => {
      const key = format(day, "yyyy-MM-dd");
      return {
        label: format(day, "EEE"),
        count: tasks.filter((t) => t.createdAt.slice(0, 10) === key).length,
      };
    });
  }, [tasks]);

  const clashes = useMemo(() => conflictedBatchIds(batches), [batches]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const shortcuts = MODULES.filter(
    (m) => m.showOnDashboard && user && canAccessModule(m, user.role),
  );

  return (
    <>
      <DashboardHero greeting={greeting} firstName={user?.name.split(" ")[0] ?? ""} />

      {/* ---- stats ------------------------------------------------------- */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <StatTile
            key={stat.id}
            label={stat.label}
            value={stat.value}
            href={stat.href}
            tone={stat.tone}
            caption={stat.caption}
            icon={stat.icon}
            ready={ready}
            stagger={i * 60}
          />
        ))}
      </div>

      {/* ---- tasks opened, last 7 days ------------------------------------ */}
      <Card interactive className="mb-5 animate-fade-in-up" style={{ "--stagger": "240ms" } as React.CSSProperties}>
        <div className="mb-1 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--subtle-foreground)]">
              Tasks opened
            </h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
              Last 7 days, across the team
            </p>
          </div>
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
            style={{ background: "var(--brand-gradient)" }}
          >
            <ChartLineUp size={17} weight="bold" />
          </span>
        </div>

        {!ready ? (
          <Skeleton className="h-[180px] w-full" />
        ) : (
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={taskTrend} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                <defs>
                  <linearGradient id="taskTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11, fontWeight: 600 }}
                />
                <YAxis hide domain={[0, (max: number) => Math.max(max, 4)]} />
                <Tooltip
                  cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    boxShadow: "var(--shadow-raised)",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--muted-foreground)", fontWeight: 600, marginBottom: 2 }}
                  itemStyle={{ color: "var(--foreground)", fontWeight: 700 }}
                  formatter={(value) => [`${value} task${value === 1 ? "" : "s"}`, "Opened"]}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="var(--primary)"
                  strokeWidth={2.5}
                  fill="url(#taskTrendFill)"
                  dot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  animationDuration={900}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {clashes.size > 0 ? (
        <Link
          href="/schedule"
          className="mb-5 flex items-center gap-2 rounded-md bg-[var(--danger-bg)] px-3 py-2.5
            text-xs font-bold text-[var(--danger)] transition-[filter] duration-150 hover:brightness-95"
        >
          <Warning size={15} weight="fill" className="shrink-0" />
          {clashes.size} batch{clashes.size === 1 ? "" : "es"} double-booked on a line, room or vessel
          <ArrowRight size={13} weight="bold" className="ml-auto shrink-0" />
        </Link>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        {/* ---- running today -------------------------------------------- */}
        <section>
          <SectionHeading title="Running today" href="/schedule" linkLabel="Full schedule" />
          {!ready ? (
            <Skeleton className="h-40 w-full" />
          ) : runningToday.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing in production today"
                description="No batches are scheduled to run across today's date."
              />
            </Card>
          ) : (
            <div className="grid gap-2">
              {runningToday.map((batch) => (
                <Card
                  key={batch.id}
                  interactive
                  className="flex flex-wrap items-center gap-x-3 gap-y-2"
                >
                  <span className="tabular text-[13px] font-extrabold text-foreground">
                    {batch.batchNo}
                  </span>
                  <ProductLineTag line={batch.productLine} />
                  <BatchStatusPill status={batch.status} size="sm" />
                  {clashes.has(batch.id) ? (
                    <Warning
                      size={14}
                      weight="fill"
                      className="text-[var(--danger)]"
                      aria-label="Resource clash"
                    />
                  ) : null}

                  <p className="w-full truncate text-xs text-[var(--muted-foreground)]">
                    {batch.product}
                  </p>

                  <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
                      {resourceById(batch.lineId)?.label ?? "No line assigned"}
                      {batch.roomId ? ` · ${resourceById(batch.roomId)?.label}` : ""}
                    </span>
                    <StaffStack
                      people={batch.operatorIds
                        .map((id) => staffById.get(id))
                        .filter((s): s is NonNullable<typeof s> => Boolean(s))}
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ---- my tasks -------------------------------------------------- */}
        <section>
          <SectionHeading title="Assigned to me" href="/tasks" linkLabel="All tasks" />
          {!ready ? (
            <Skeleton className="h-40 w-full" />
          ) : myTasks.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing assigned to you"
                description="You have no open tasks. Anything assigned to you will appear here."
              />
            </Card>
          ) : (
            <div className="grid gap-2">
              {myTasks.slice(0, 6).map((task) => (
                <Link
                  key={task.id}
                  href="/tasks"
                  className="card-interactive rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3
                    shadow-[var(--shadow-card)]"
                >
                  <p className="text-[13px] font-bold leading-snug text-foreground">{task.title}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2.5">
                    <TaskStatusPill status={task.status} size="sm" />
                    <PriorityTag priority={task.priority} />
                    <span className="ml-auto">
                      <DueDate date={task.dueDate} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ---- module shortcuts ------------------------------------------- */}
      <section className="mt-6">
        <SectionHeading title="Go to" />
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((module) => {
            const Icon = module.icon;
            return (
              <Link
                key={module.id}
                href={module.href}
                className="card-interactive group flex items-start gap-3 rounded-lg border border-[var(--border)]
                  bg-[var(--surface)] p-3.5 shadow-[var(--shadow-card)]"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white
                    transition-transform duration-200 group-hover:scale-110"
                  style={{ background: "var(--brand-gradient)" }}
                >
                  <Icon size={18} weight="fill" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-[13px] font-bold text-foreground">
                    {module.label}
                    <ArrowRight
                      size={12}
                      weight="bold"
                      className="text-[var(--subtle-foreground)] transition-colors duration-150
                        group-hover:text-[var(--brand-500)]"
                    />
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-[var(--muted-foreground)]">
                    {module.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function DashboardHero({ greeting, firstName }: { greeting: string; firstName: string }) {
  return (
    <div
      className="relative mb-5 overflow-hidden rounded-xl p-5 text-white sm:p-7"
      style={{ background: "var(--brand-gradient)" }}
    >
      <span
        className="ambient-blob pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl"
        aria-hidden="true"
      />
      <span
        className="ambient-blob pointer-events-none absolute -bottom-24 left-10 h-48 w-48 rounded-full bg-white/10 blur-3xl"
        style={{ animationDelay: "-4.5s" }}
        aria-hidden="true"
      />
      <div className="relative">
        <p className="text-[13px] font-semibold text-white/75">
          {format(new Date(), "EEEE d MMMM yyyy")}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
          {greeting}, {firstName}
        </h1>
        <Link
          href="/schedule"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-white/90
            transition-colors duration-150 hover:text-white"
        >
          View full schedule
          <ArrowRight size={14} weight="bold" />
        </Link>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  href,
  tone,
  caption,
  icon,
  ready,
  stagger,
}: {
  label: string;
  value: number;
  href: string;
  tone: string;
  caption: string;
  icon: ReactNode;
  ready: boolean;
  stagger: number;
}) {
  return (
    <Link
      href={href}
      className="card-interactive group animate-fade-in-up flex items-center justify-between gap-3
        rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-card)]"
      style={{ "--stagger": `${stagger}ms` } as React.CSSProperties}
    >
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          {label}
        </p>
        {ready ? (
          <p className="tabular mt-1 text-3xl font-extrabold" style={{ color: tone }}>
            {value}
          </p>
        ) : (
          <Skeleton className="mt-1.5 h-8 w-10" />
        )}
        <p className="mt-0.5 truncate text-[11px] text-[var(--subtle-foreground)]">{caption}</p>
      </div>
      <span
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white
          shadow-[var(--shadow-glow)] transition-transform duration-200 group-hover:scale-110"
        style={{ background: "var(--brand-gradient)" }}
      >
        {icon}
      </span>
    </Link>
  );
}

function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--subtle-foreground)]">
        {title}
      </h2>
      {href ? (
        <Link
          href={href}
          className="text-[11px] font-bold text-[var(--brand-600)] transition-opacity duration-150 hover:opacity-75"
        >
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
