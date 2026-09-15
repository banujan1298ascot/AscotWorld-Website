"use client";

import { useMemo } from "react";
import { notificationCollection } from "./seed";
import { useCollection } from "./storage";
import type { NotificationType } from "./types";

/* ============================================================================
 * Notifications
 * ----------------------------------------------------------------------------
 * A flat, per-recipient list. Anything elsewhere in the app that should alert
 * someone — a new message, a task assignment, a batch status change — calls
 * `pushNotification` rather than writing to the collection directly, so the
 * shape stays consistent everywhere it's triggered from.
 * ========================================================================= */

export function pushNotification(input: {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
}): void {
  notificationCollection.create({ ...input, read: false });
}

export function markNotificationRead(id: string): void {
  const notification = notificationCollection.find(id);
  if (!notification || notification.read) return;
  notificationCollection.update(id, { read: true });
}

export function markAllNotificationsRead(userId: string): void {
  notificationCollection
    .all()
    .filter((n) => n.recipientId === userId && !n.read)
    .forEach((n) => notificationCollection.update(n.id, { read: true }));
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

/** Every notification for `userId`, newest first. */
export function useNotificationsFor(userId: string | undefined) {
  const { items: notifications, ready } = useCollection(notificationCollection);
  const filtered = useMemo(
    () =>
      userId
        ? notifications
            .filter((n) => n.recipientId === userId)
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : [],
    [notifications, userId],
  );
  return { notifications: filtered, ready };
}

export function useUnreadNotificationCount(userId: string | undefined): number {
  const { items: notifications } = useCollection(notificationCollection);
  return useMemo(() => {
    if (!userId) return 0;
    return notifications.filter((n) => n.recipientId === userId && !n.read).length;
  }, [notifications, userId]);
}
