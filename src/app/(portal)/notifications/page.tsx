"use client";

import Link from "next/link";
import { format, isSameDay } from "date-fns";
import {
  CalendarBlank,
  ChatCircleDots,
  CheckCircle,
  Flask,
  ListChecks,
} from "@phosphor-icons/react/dist/ssr";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { markAllNotificationsRead, markNotificationRead, useNotificationsFor } from "@/lib/notifications";
import { NOTIFICATION_TYPE, type AppNotification, type NotificationType } from "@/lib/types";

const TYPE_ICON: Record<NotificationType, typeof ChatCircleDots> = {
  message: ChatCircleDots,
  task: ListChecks,
  batch: CalendarBlank,
  mes: Flask,
};

function notificationTime(iso: string): string {
  const date = new Date(iso);
  return isSameDay(date, new Date())
    ? format(date, "HH:mm")
    : format(date, "d MMM 'at' HH:mm");
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const { notifications, ready } = useNotificationsFor(user?.id);
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          ready
            ? unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up."
            : undefined
        }
        actions={
          unreadCount > 0 ? (
            <button
              onClick={() => user && markAllNotificationsRead(user.id)}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-2 text-[13px]
                font-bold text-[var(--brand-600)] transition-colors duration-150
                hover:bg-[var(--brand-50)]"
            >
              <CheckCircle size={16} weight="bold" />
              Mark all as read
            </button>
          ) : null
        }
      />

      {!ready ? (
        <Skeleton className="h-96 w-full" />
      ) : notifications.length === 0 ? (
        <Card>
          <EmptyState
            title="No notifications yet"
            description="Task assignments, batch updates and new messages will show up here."
          />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {notifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function NotificationRow({ notification }: { notification: AppNotification }) {
  const Icon = TYPE_ICON[notification.type];
  return (
    <li>
      <Link
        href={notification.href}
        onClick={() => markNotificationRead(notification.id)}
        className={`flex items-start gap-3 px-4 py-3 transition-colors duration-150
          hover:bg-[var(--surface-sunken)] ${notification.read ? "" : "bg-[var(--brand-50)]"}`}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
          style={{ background: "var(--surface-sunken)", color: "var(--brand-600)" }}
        >
          <Icon size={17} weight="fill" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate text-[13px] ${notification.read ? "font-bold text-foreground" : "font-extrabold text-foreground"}`}
            >
              {notification.title}
            </span>
            <span className="tabular shrink-0 text-[11px] font-semibold text-[var(--subtle-foreground)]">
              {notificationTime(notification.createdAt)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
            {notification.body}
          </span>
          <span className="mt-1 inline-block rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)]">
            {NOTIFICATION_TYPE[notification.type].label}
          </span>
        </span>

        {!notification.read ? (
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--primary)]"
            aria-label="Unread"
          />
        ) : null}
      </Link>
    </li>
  );
}
