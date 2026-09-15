"use client";

import { useEffect } from "react";
import { addDays, format } from "date-fns";
import { pushNotification } from "./notifications";
import { taskCollection } from "./seed";
import { useCollection } from "./storage";

/* ============================================================================
 * Due-tomorrow reminders
 * ----------------------------------------------------------------------------
 * There's no server here, so nothing can fire in the background at a fixed
 * time — this checks the signed-in user's tasks whenever the portal is open
 * (called once from the portal layout) and sends a reminder the first time it
 * sees a task due tomorrow. `reminderSentFor` on the task records which day
 * that check last fired for, so reopening the portal the same day doesn't
 * send it again.
 * ========================================================================= */

export function useDueTomorrowReminders(userId: string | undefined): void {
  const { items: tasks } = useCollection(taskCollection);

  useEffect(() => {
    if (!userId) return;

    const today = format(new Date(), "yyyy-MM-dd");
    const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");

    tasks
      .filter(
        (t) =>
          t.assigneeId === userId &&
          t.status !== "done" &&
          t.dueDate === tomorrow &&
          t.reminderSentFor !== today,
      )
      .forEach((t) => {
        pushNotification({
          recipientId: userId,
          type: "task",
          title: "Due tomorrow",
          body: t.title,
          href: "/tasks",
        });
        taskCollection.update(t.id, { reminderSentFor: today });
      });
  }, [tasks, userId]);
}
