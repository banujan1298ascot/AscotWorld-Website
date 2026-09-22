"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { addDays, addWeeks, eachDayOfInterval, format, isSameDay, startOfWeek } from "date-fns";
import {
  CaretLeft,
  CaretRight,
  Circle,
  Drop,
  Pill,
  Plus,
  SealCheck,
  Trash,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { BatchStatusPill, ProductLineTag, StaffStack } from "@/components/domain";
import {
  Avatar,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageHeader,
  PermissionNotice,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { pushNotification } from "@/lib/notifications";
import { batchCollection, staffCollection } from "@/lib/seed";
import { conflictedBatchIds, findConflicts, layoutWeekBars, resourceById, type WeekBar } from "@/lib/schedule";
import { useCollection } from "@/lib/storage";
import {
  BATCH_STATUS,
  PRODUCT_LINE,
  RESOURCES,
  type Batch,
  type BatchStatus,
  type ProductLine,
} from "@/lib/types";

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** The working week is Monday–Saturday; Sunday is never shown. */
const WORKING_DAYS = 6;

/** The three lines that run independently of one another, each with its own
 *  calendar. Order here is display order, top to bottom. */
const CALENDAR_LINES: Array<{
  id: string;
  title: string;
  icon: PhosphorIcon;
  color: string;
  bg: string;
}> = [
  { id: "line-1", title: "Liquids", icon: Drop, color: "var(--line-liquids)", bg: "var(--line-liquids-bg)" },
  { id: "line-3", title: "Capsules", icon: Pill, color: "var(--line-capsules)", bg: "var(--line-capsules-bg)" },
  { id: "line-4", title: "Tablets", icon: Circle, color: "var(--line-tablets)", bg: "var(--line-tablets-bg)" },
];
const PARALLEL_LINE_IDS = new Set(CALENDAR_LINES.map((l) => l.id));
const isParallelLineId = (lineId: string | null) => (lineId ? PARALLEL_LINE_IDS.has(lineId) : false);

/** A batch being scheduled by dragging, or via the "+" on an empty day. */
interface DragOrigin {
  batchId: string;
  dayIndex: number;
  lineId: string | null;
}
interface DropTarget {
  calendarId: string;
  dayIndex: number;
}
/** What to prefill when opening the dialog to create a batch. */
interface CreatePrefill {
  lineId: string | null;
  date: string;
}

/** Everyone with a stake in a batch — its operators plus its QA owner, deduplicated. */
function batchStakeholders(batch: Batch): string[] {
  return Array.from(new Set([...batch.operatorIds, ...(batch.qaOwnerId ? [batch.qaOwnerId] : [])]));
}

/** Notifies a batch's crew about something, skipping whoever caused it. */
function notifyBatchStakeholders(
  batch: Batch,
  title: string,
  body: string,
  actorId: string | undefined,
): void {
  batchStakeholders(batch)
    .filter((id) => id !== actorId)
    .forEach((recipientId) => {
      pushNotification({ recipientId, type: "batch", title, body, href: "/schedule" });
    });
}

export default function SchedulePage() {
  const { user, can } = useAuth();
  const { items: batches, ready } = useCollection(batchCollection);
  const { items: staff } = useCollection(staffCollection);

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selected, setSelected] = useState<Batch | null>(null);
  const [creating, setCreating] = useState<CreatePrefill | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DropTarget | null>(null);
  const dragOriginRef = useRef<DragOrigin | null>(null);
  // Cards show only the essentials; the full picture appears on hover.
  const [hoverCard, setHoverCard] = useState<{ batch: Batch; rect: DOMRect } | null>(null);

  const now = new Date();
  const canCreate = can("batch.create");
  const canReschedule = canCreate || can("batch.updateProgress");

  const conflicts = useMemo(() => conflictedBatchIds(batches), [batches]);

  const weekDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, WORKING_DAYS - 1) }),
    [weekStart],
  );
  const todayIndex = weekDays.findIndex((d) => isSameDay(d, now));

  const activeBatches = useMemo(() => batches.filter((b) => b.status !== "cancelled"), [batches]);
  const weekDaysIso = useMemo(() => weekDays.map(iso), [weekDays]);

  /** Batches touching this week at all, for each line — laid out as bars
   *  (one per batch, spanning every day it covers) rather than repeated
   *  per day. */
  const lineCalendars = CALENDAR_LINES.map((line) => ({
    ...line,
    bars: layoutWeekBars(activeBatches.filter((b) => b.lineId === line.id), weekDaysIso),
  }));
  const otherBars = layoutWeekBars(activeBatches.filter((b) => !isParallelLineId(b.lineId)), weekDaysIso);

  /** Shifts a batch's whole date range by `deltaDays`, keeping its duration. */
  function rescheduleBatch(batchId: string, deltaDays: number) {
    if (deltaDays === 0) return;
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const shift = (d: string) => iso(addDays(new Date(`${d}T00:00:00`), deltaDays));
    const startDate = shift(batch.startDate);
    const endDate = shift(batch.endDate);
    batchCollection.update(batch.id, { startDate, endDate });
    notifyBatchStakeholders(
      { ...batch, startDate, endDate },
      `Batch ${batch.batchNo} rescheduled`,
      `Now ${format(new Date(`${startDate}T00:00:00`), "d MMM")} – ${format(new Date(`${endDate}T00:00:00`), "d MMM")}`,
      user?.id,
    );
  }

  /** A calendar only accepts a drop from the line it represents — "other"
   *  accepts anything that isn't one of the three parallel lines. */
  function accepts(calendarId: string, lineId: string | null): boolean {
    return calendarId === "other" ? !isParallelLineId(lineId) : lineId === calendarId;
  }

  function handleDragOverDay(e: React.DragEvent, calendarId: string, dayIndex: number) {
    const origin = dragOriginRef.current;
    if (!origin || !accepts(calendarId, origin.lineId)) return;
    e.preventDefault();
    setDragOverTarget({ calendarId, dayIndex });
  }
  function handleDragLeaveDay(calendarId: string, dayIndex: number) {
    setDragOverTarget((t) => (t?.calendarId === calendarId && t.dayIndex === dayIndex ? null : t));
  }
  function handleDropDay(e: React.DragEvent, calendarId: string, dayIndex: number) {
    const origin = dragOriginRef.current;
    if (!origin || !accepts(calendarId, origin.lineId)) return;
    e.preventDefault();
    dragOriginRef.current = null;
    setDragOverTarget(null);
    rescheduleBatch(origin.batchId, dayIndex - origin.dayIndex);
  }

  /** Cards stay minimal; this is how the full picture surfaces on hover. */
  function handleCardHover(batch: Batch, rect: DOMRect | null) {
    if (rect) {
      setHoverCard({ batch, rect });
    } else {
      setHoverCard((h) => (h?.batch.id === batch.id ? null : h));
    }
  }

  return (
    <>
      <PageHeader
        title="Batch schedule"
        description="Liquids, Capsules and Tablets run independently — each gets its own weekly calendar."
        actions={
          canCreate ? (
            <Button
              variant="primary"
              icon={<Plus size={16} weight="bold" />}
              onClick={() => setCreating({ lineId: null, date: iso(new Date()) })}
            >
              Schedule batch
            </Button>
          ) : null
        }
      />

      {conflicts.size > 0 ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-[var(--status-cancelled)]/30
            bg-[var(--danger-bg)] px-3 py-2.5 text-xs font-semibold text-[var(--danger)]"
        >
          <Warning size={15} weight="fill" className="mt-px shrink-0" />
          <span>
            {conflicts.size} batch{conflicts.size === 1 ? " is" : "es are"} double-booked on a line,
            room or vessel. Affected runs are marked on the calendars below.
          </span>
        </div>
      ) : null}

      {/* ---- week controls ------------------------------------------------ */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setWeekStart((w) => addWeeks(w, -1))}
            aria-label="Previous week"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-[var(--border)]
              bg-[var(--surface)] text-[var(--muted-foreground)] transition-[background-color,color,box-shadow] duration-150
              hover:bg-[var(--surface-sunken)] hover:text-foreground hover:shadow-[var(--shadow-glow)]"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <button
            onClick={() => setWeekStart((w) => addWeeks(w, 1))}
            aria-label="Next week"
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-[var(--border)]
              bg-[var(--surface)] text-[var(--muted-foreground)] transition-[background-color,color,box-shadow] duration-150
              hover:bg-[var(--surface-sunken)] hover:text-foreground hover:shadow-[var(--shadow-glow)]"
          >
            <CaretRight size={15} weight="bold" />
          </button>
          <h2 className="ml-2 text-base font-extrabold tracking-tight">
            {format(weekDays[0], "d MMM")} – {format(weekDays[weekDays.length - 1], "d MMM yyyy")}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          >
            Today
          </Button>
        </div>

        {canReschedule ? (
          <p className="text-[11px] font-medium text-[var(--subtle-foreground)]">
            Drag a batch to a different day to reschedule it, or use the + on an empty day.
          </p>
        ) : null}
      </div>

      {/* ---- calendars ----------------------------------------------------- */}
      {!ready ? (
        <div className="grid gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="grid gap-4">
          {lineCalendars.map((line) => (
            <LineCalendar
              key={line.id}
              calendarId={line.id}
              title={line.title}
              Icon={line.icon}
              color={line.color}
              bg={line.bg}
              weekDays={weekDays}
              bars={line.bars}
              todayIndex={todayIndex}
              conflicts={conflicts}
              canReschedule={canReschedule}
              canCreate={canCreate}
              dragOriginRef={dragOriginRef}
              dragOverTarget={dragOverTarget}
              onDragOverDay={handleDragOverDay}
              onDragLeaveDay={handleDragLeaveDay}
              onDropDay={handleDropDay}
              onDragEnd={() => setDragOverTarget(null)}
              onSelect={setSelected}
              onHover={handleCardHover}
              onQuickCreate={(day) => setCreating({ lineId: line.id, date: iso(day) })}
            />
          ))}

          {otherBars.length > 0 ? (
            <LineCalendar
              calendarId="other"
              title="Other lines"
              Icon={Circle}
              color="var(--muted-foreground)"
              bg="var(--surface-sunken)"
              weekDays={weekDays}
              bars={otherBars}
              todayIndex={todayIndex}
              conflicts={conflicts}
              canReschedule={canReschedule}
              canCreate={false}
              dragOriginRef={dragOriginRef}
              dragOverTarget={dragOverTarget}
              onDragOverDay={handleDragOverDay}
              onDragLeaveDay={handleDragLeaveDay}
              onDropDay={handleDropDay}
              onDragEnd={() => setDragOverTarget(null)}
              onSelect={setSelected}
              onHover={handleCardHover}
            />
          ) : null}
        </div>
      )}

      {/* ---- legend --------------------------------------------------------- */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(Object.keys(BATCH_STATUS) as BatchStatus[])
          .sort((a, b) => BATCH_STATUS[a].order - BATCH_STATUS[b].order)
          .map((s) => (
            <BatchStatusPill key={s} status={s} size="sm" />
          ))}
      </div>

      {/* ---- hover card -----------------------------------------------------
          Calendar pills show only the product name; everything else — batch
          number, line, quantity, dates, room, equipment — appears here on
          hover. Fixed positioning keeps it clear of the calendar's own
          scroll/clip regions regardless of where the pill sits. */}
      {hoverCard ? (
        <BatchHoverDetails
          batch={hoverCard.batch}
          anchor={hoverCard.rect}
          clashing={conflicts.has(hoverCard.batch.id)}
        />
      ) : null}

      {/* ---- dialogs ----------------------------------------------------- */}
      {creating ? (
        <BatchDialog
          open
          title="Schedule a batch"
          allBatches={batches}
          staff={staff}
          initialLineId={creating.lineId}
          initialDate={creating.date}
          onClose={() => setCreating(null)}
          onSave={(values) => {
            const batch = batchCollection.create(values);
            notifyBatchStakeholders(
              batch,
              `Added to batch ${batch.batchNo}`,
              batch.product,
              user?.id,
            );
            setCreating(null);
          }}
        />
      ) : null}

      {selected ? (
        <BatchDialog
          open
          title={`Batch ${selected.batchNo}`}
          batch={selected}
          allBatches={batches}
          staff={staff}
          onClose={() => setSelected(null)}
          onSave={(values) => {
            const previousStatus = selected.status;
            const batch = batchCollection.update(selected.id, values) ?? { ...selected, ...values };
            if (values.status !== previousStatus) {
              if (values.status === "qa_hold") {
                notifyBatchStakeholders(
                  batch,
                  `Batch ${batch.batchNo} on QA hold`,
                  batch.product,
                  user?.id,
                );
              } else if (values.status === "released") {
                notifyBatchStakeholders(
                  batch,
                  `Batch ${batch.batchNo} released`,
                  batch.product,
                  user?.id,
                );
              }
            }
            setSelected(null);
          }}
          onDelete={
            can("batch.delete")
              ? () => {
                  batchCollection.remove(selected.id);
                  setSelected(null);
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Line calendar — one line's week, Vision-UI-style pill events               */
/* -------------------------------------------------------------------------- */

function LineCalendar({
  calendarId,
  title,
  Icon,
  color,
  bg,
  weekDays,
  bars,
  todayIndex,
  conflicts,
  canReschedule,
  canCreate,
  dragOriginRef,
  dragOverTarget,
  onDragOverDay,
  onDragLeaveDay,
  onDropDay,
  onDragEnd,
  onSelect,
  onHover,
  onQuickCreate,
}: {
  calendarId: string;
  title: string;
  Icon: PhosphorIcon;
  color: string;
  bg: string;
  weekDays: Date[];
  /** One entry per batch touching this week — a continuous bar, not a copy
   *  per day it spans. See `layoutWeekBars`. */
  bars: WeekBar[];
  todayIndex: number;
  conflicts: Set<string>;
  canReschedule: boolean;
  canCreate: boolean;
  dragOriginRef: RefObject<DragOrigin | null>;
  dragOverTarget: DropTarget | null;
  onDragOverDay: (e: React.DragEvent, calendarId: string, dayIndex: number) => void;
  onDragLeaveDay: (calendarId: string, dayIndex: number) => void;
  onDropDay: (e: React.DragEvent, calendarId: string, dayIndex: number) => void;
  onDragEnd: () => void;
  onSelect: (batch: Batch) => void;
  onHover: (batch: Batch, rect: DOMRect | null) => void;
  onQuickCreate?: (day: Date) => void;
}) {
  // At least one lane always, so an all-idle week still gets a normal-height
  // row rather than collapsing to just the day headers.
  const laneCount = Math.max(1, ...bars.map((bar) => bar.lane + 1));

  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-3">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white"
          style={{ background: color }}
        >
          <Icon size={16} weight="bold" />
        </span>
        <h3 className="text-sm font-extrabold tracking-tight text-foreground">{title}</h3>
        <span className="ml-auto text-[11px] font-semibold text-[var(--muted-foreground)]">
          {bars.length} batch{bars.length === 1 ? "" : "es"} this week
        </span>
      </div>

      {/* One grid holds both the day columns (background, headers, idle/+
          slots, drag targets) and the batch bars — each bar is placed with
          an explicit column *span* across every day it covers and a row for
          its lane, so a multi-day batch renders as one continuous bar
          instead of a copy repeated in each day it touches. A day's
          background is one item spanning every lane row, so it paints
          underneath its bars with no seam.

          The header row's height is a fixed `minmax` floor, not `auto`:
          every item that spans it (each day's background) spans several
          rows, and CSS Grid explicitly excludes multi-row-spanning items
          from an `auto` track's sizing — so with a bar under every single
          day this week (nothing left to prop the row open on its own),
          `auto` collapsed the header row to 0px and the bars, painted
          after it, covered the date labels entirely. */}
      <div
        className="relative grid"
        style={{
          gridTemplateColumns: `repeat(${WORKING_DAYS}, minmax(0, 1fr))`,
          gridTemplateRows: `minmax(1.75rem, auto) repeat(${laneCount}, minmax(3rem, auto))`,
          rowGap: "0.25rem",
        }}
      >
        {weekDays.map((day, dayIndex) => {
          const isToday = dayIndex === todayIndex;
          const isDropTarget =
            dragOverTarget?.calendarId === calendarId && dragOverTarget.dayIndex === dayIndex;
          const dayIsCovered = bars.some((bar) => dayIndex >= bar.startIndex && dayIndex <= bar.endIndex);
          return (
            <div
              key={dayIndex}
              onDragOver={canReschedule ? (e) => onDragOverDay(e, calendarId, dayIndex) : undefined}
              onDragLeave={() => onDragLeaveDay(calendarId, dayIndex)}
              onDrop={canReschedule ? (e) => onDropDay(e, calendarId, dayIndex) : undefined}
              style={{ gridColumn: dayIndex + 1, gridRow: `1 / span ${1 + laneCount}` }}
              className={`group flex flex-col gap-1.5 p-2 transition-colors duration-100 ${
                dayIndex === WORKING_DAYS - 1 ? "" : "border-r border-[var(--border)]"
              } ${isDropTarget ? "bg-[var(--brand-50)]" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {format(day, "EEE")}
                </span>
                <span
                  className={`tabular grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${
                    isToday ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-foreground"
                  }`}
                >
                  {format(day, "d")}
                </span>
              </div>

              {!dayIsCovered && canCreate && onQuickCreate ? (
                <button
                  type="button"
                  aria-label={`Schedule a ${title} batch on ${format(day, "EEEE d MMMM")}`}
                  onClick={() => onQuickCreate(day)}
                  className="flex flex-1 items-center justify-center rounded-md border border-dashed
                    opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  style={{ borderColor: color, color, background: bg }}
                >
                  <Plus size={14} weight="bold" />
                </button>
              ) : !dayIsCovered ? (
                <div className="flex-1 rounded-md border border-dashed border-[var(--border)]" />
              ) : null}
            </div>
          );
        })}

        {bars.map((bar) => (
          <div
            key={bar.batch.id}
            style={{ gridColumn: `${bar.startIndex + 1} / ${bar.endIndex + 2}`, gridRow: bar.lane + 2 }}
            className="p-0.5"
          >
            <EventBar
              batch={bar.batch}
              dayIndex={bar.startIndex}
              lineId={bar.batch.lineId}
              clashing={conflicts.has(bar.batch.id)}
              clippedStart={bar.clippedStart}
              clippedEnd={bar.clippedEnd}
              canReschedule={canReschedule}
              dragOriginRef={dragOriginRef}
              onDragEnd={onDragEnd}
              onSelect={onSelect}
              onHover={onHover}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Event bar — one batch, spanning every day it covers this week              */
/* -------------------------------------------------------------------------- */

function EventBar({
  batch,
  dayIndex,
  lineId,
  clashing,
  clippedStart,
  clippedEnd,
  canReschedule,
  dragOriginRef,
  onDragEnd,
  onSelect,
  onHover,
}: {
  batch: Batch;
  /** The bar's visible start day within the week — used as the drag
   *  origin, since the whole bar moves together regardless of where along
   *  its length it's grabbed. */
  dayIndex: number;
  lineId: string | null;
  clashing: boolean;
  /** The batch actually starts before/continues after this week — drawn
   *  with a flat edge and a caret instead of a rounded end, so a bar that's
   *  cut off by the week boundary doesn't look like it ends there. */
  clippedStart: boolean;
  clippedEnd: boolean;
  canReschedule: boolean;
  dragOriginRef: RefObject<DragOrigin | null>;
  onDragEnd: () => void;
  onSelect: (batch: Batch) => void;
  onHover: (batch: Batch, rect: DOMRect | null) => void;
}) {
  const meta = BATCH_STATUS[batch.status];

  return (
    <button
      type="button"
      onClick={() => onSelect(batch)}
      onMouseEnter={(e) => onHover(batch, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onHover(batch, null)}
      aria-label={`${batch.product} — batch ${batch.batchNo}, ${meta.label}${
        clashing ? ", resource clash" : ""
      }${clippedStart ? ", continues from before this week" : ""}${
        clippedEnd ? ", continues after this week" : ""
      }`}
      draggable={canReschedule}
      onDragStart={(e) => {
        onHover(batch, null);
        dragOriginRef.current = { batchId: batch.id, dayIndex, lineId };
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        dragOriginRef.current = null;
        onDragEnd();
      }}
      className={`flex h-full w-full min-w-0 items-center gap-1 px-2 text-left
        text-[11px] font-bold leading-tight transition-[filter,transform] duration-150
        hover:brightness-95 active:scale-[0.98]
        ${clippedStart ? "rounded-l-none" : "rounded-l-md"} ${clippedEnd ? "rounded-r-none" : "rounded-r-md"}
        ${canReschedule ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      style={{ color: meta.colorVar, background: meta.bgVar }}
    >
      {clippedStart ? <CaretLeft size={10} weight="bold" className="shrink-0 opacity-60" /> : null}
      {clashing ? (
        <Warning size={10} weight="fill" className="shrink-0 text-[var(--danger)]" />
      ) : null}
      <span className="truncate">{batch.product}</span>
      {clippedEnd ? <CaretRight size={10} weight="bold" className="ml-auto shrink-0 opacity-60" /> : null}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Batch hover details — the full picture, shown on hover only                */
/* -------------------------------------------------------------------------- */

const HOVER_CARD_WIDTH = 240;
const HOVER_CARD_MARGIN = 8;

function BatchHoverDetails({
  batch,
  anchor,
  clashing,
}: {
  batch: Batch;
  anchor: DOMRect;
  clashing: boolean;
}) {
  const line = resourceById(batch.lineId);
  const room = resourceById(batch.roomId);
  const equipment = resourceById(batch.equipmentId);

  // Anchored beside the pill, level with its top edge, flipping to the left
  // when there isn't room on the right. Vertical position is clamped to the
  // viewport.
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const fitsRight = anchor.right + HOVER_CARD_MARGIN + HOVER_CARD_WIDTH <= viewportWidth;
  const left = fitsRight
    ? anchor.right + HOVER_CARD_MARGIN
    : Math.max(HOVER_CARD_MARGIN, anchor.left - HOVER_CARD_MARGIN - HOVER_CARD_WIDTH);
  const top = Math.min(Math.max(anchor.top, HOVER_CARD_MARGIN), viewportHeight - 260);

  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-lg border border-[var(--border)]
        bg-[var(--surface-raised)] p-3 text-xs shadow-[var(--shadow-overlay)]"
      style={{ top, left, width: HOVER_CARD_WIDTH }}
    >
      <p className="font-bold text-foreground">{batch.product}</p>
      <p className="tabular mt-0.5 text-[var(--muted-foreground)]">{batch.batchNo}</p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        <dt className="text-[var(--subtle-foreground)]">Line</dt>
        <dd className="truncate font-semibold">{line?.label ?? "Not assigned"}</dd>
        <dt className="text-[var(--subtle-foreground)]">Quantity</dt>
        <dd className="tabular font-semibold">
          {batch.quantity} {batch.unit}
        </dd>
        <dt className="text-[var(--subtle-foreground)]">Dates</dt>
        <dd className="tabular font-semibold">
          {format(new Date(`${batch.startDate}T00:00:00`), "d MMM")} –{" "}
          {format(new Date(`${batch.endDate}T00:00:00`), "d MMM yyyy")}
        </dd>
        {room ? (
          <>
            <dt className="text-[var(--subtle-foreground)]">Room</dt>
            <dd className="truncate font-semibold">{room.label}</dd>
          </>
        ) : null}
        {equipment ? (
          <>
            <dt className="text-[var(--subtle-foreground)]">Equipment</dt>
            <dd className="truncate font-semibold">{equipment.label}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-2 flex items-center gap-1.5">
        <BatchStatusPill status={batch.status} size="sm" />
        {clashing ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--danger)]">
            <Warning size={12} weight="fill" />
            Clash
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Batch dialog                                                               */
/* -------------------------------------------------------------------------- */

type BatchValues = Omit<Batch, "id" | "createdAt" | "updatedAt">;

function BatchDialog({
  open,
  title,
  batch,
  allBatches,
  staff,
  initialLineId,
  initialDate,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  title: string;
  batch?: Batch;
  allBatches: readonly Batch[];
  staff: readonly ReturnType<typeof staffCollection.find>[];
  /** Prefill for a new batch opened from a specific calendar/day — ignored when editing. */
  initialLineId?: string | null;
  initialDate?: string;
  onClose: () => void;
  onSave: (values: BatchValues) => void;
  onDelete?: () => void;
}) {
  const { user, can } = useAuth();

  const canSchedule = can("batch.create");
  const canProgress = can("batch.updateProgress");
  const canRelease = can("batch.release");
  const readOnly = !canSchedule && !canProgress;

  const [values, setValues] = useState<BatchValues>({
    batchNo: batch?.batchNo ?? "",
    product: batch?.product ?? "",
    productLine: batch?.productLine ?? "human",
    quantity: batch?.quantity ?? 0,
    unit: batch?.unit ?? "bottles",
    startDate: batch?.startDate ?? initialDate ?? iso(new Date()),
    endDate: batch?.endDate ?? initialDate ?? iso(new Date()),
    status: batch?.status ?? "scheduled",
    lineId: batch?.lineId ?? initialLineId ?? null,
    roomId: batch?.roomId ?? null,
    equipmentId: batch?.equipmentId ?? null,
    operatorIds: batch?.operatorIds ?? [],
    qaOwnerId: batch?.qaOwnerId ?? null,
    releasedById: batch?.releasedById ?? null,
    releasedAt: batch?.releasedAt ?? null,
    notes: batch?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  // A browser-native `confirm()` is unreliable — some embedded/automated
  // browser contexts silently reject it with no dialog and no error, which
  // made Delete look like it did nothing. An in-app confirmation step always
  // works.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function set<K extends keyof BatchValues>(key: K, value: BatchValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setError(null);
  }

  // Live clash check against the current form values, not just the saved batch.
  const draft: Batch = {
    ...(batch ?? { id: "draft", createdAt: "", updatedAt: "" }),
    ...values,
  } as Batch;
  const clashes = findConflicts(draft, allBatches);

  const operators = staff.filter((s) => s?.role === "production");
  const qaStaff = staff.filter((s) => s?.role === "qa");

  function handleSave() {
    if (!values.batchNo.trim()) return setError("Enter a batch number.");
    if (!values.product.trim()) return setError("Enter the product being made.");
    if (values.endDate < values.startDate) {
      return setError("The end date cannot fall before the start date.");
    }
    onSave({
      ...values,
      batchNo: values.batchNo.trim().toUpperCase(),
      product: values.product.trim(),
    });
  }

  /** Releasing stamps who signed it off and when — a QA-only action. */
  function handleRelease() {
    if (!user) return;
    onSave({
      ...values,
      status: "released",
      releasedById: user.id,
      releasedAt: new Date().toISOString(),
    });
  }

  const releasedBy = values.releasedById
    ? staff.find((s) => s?.id === values.releasedById)
    : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={batch?.product}
      footer={
        confirmingDelete ? (
          <>
            <span className="mr-auto text-xs font-semibold text-[var(--danger)]">
              Delete batch {values.batchNo}? This cannot be undone.
            </span>
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              icon={<Trash size={15} weight="bold" />}
              onClick={() => onDelete?.()}
            >
              Delete permanently
            </Button>
          </>
        ) : (
          <>
            {onDelete ? (
              <Button
                variant="ghost"
                icon={<Trash size={15} weight="bold" />}
                onClick={() => setConfirmingDelete(true)}
                className="mr-auto !text-[var(--danger)] hover:!bg-[var(--danger-bg)]"
              >
                Delete
              </Button>
            ) : null}
            <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
            {canRelease && batch && values.status !== "released" && values.status !== "cancelled" ? (
              <Button
                icon={<SealCheck size={15} weight="fill" />}
                onClick={handleRelease}
                className="!bg-[var(--status-released-bg)] !text-[var(--status-released)] !border-transparent"
              >
                Release batch
              </Button>
            ) : null}
            {!readOnly ? (
              <Button variant="primary" onClick={handleSave}>
                Save batch
              </Button>
            ) : null}
          </>
        )
      }
    >
      {readOnly ? (
        <div className="mb-4">
          <PermissionNotice message="You have read-only access — batch details can be viewed but not changed." />
        </div>
      ) : null}

      {values.status === "released" && releasedBy ? (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-[var(--status-released-bg)] px-3 py-2 text-xs font-semibold text-[var(--status-released)]">
          <SealCheck size={15} weight="fill" className="shrink-0" />
          Released by {releasedBy.name}
          {values.releasedAt
            ? ` on ${format(new Date(values.releasedAt), "d MMM yyyy 'at' HH:mm")}`
            : ""}
        </div>
      ) : null}

      {clashes.length > 0 ? (
        <div
          role="alert"
          className="mb-4 rounded-md bg-[var(--danger-bg)] px-3 py-2.5 text-xs text-[var(--danger)]"
        >
          <p className="flex items-center gap-1.5 font-bold">
            <Warning size={14} weight="fill" />
            Resource clash
          </p>
          <ul className="mt-1 grid gap-0.5 pl-5">
            {clashes.map((c, i) => (
              <li key={i} className="list-disc font-medium">
                <strong>{c.resource.label}</strong> is already booked by {c.other.batchNo} (
                {format(new Date(`${c.other.startDate}T00:00:00`), "d MMM")}–
                {format(new Date(`${c.other.endDate}T00:00:00`), "d MMM")}).
              </li>
            ))}
          </ul>
          <p className="mt-1.5 font-medium opacity-80">
            You can still save — this is a warning, not a block — but production will need to
            resolve it.
          </p>
        </div>
      ) : null}

      <fieldset disabled={readOnly} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Batch number" htmlFor="batch-no" required>
            <Input
              id="batch-no"
              className="tabular"
              value={values.batchNo}
              onChange={(e) => set("batchNo", e.target.value)}
              placeholder="AW-24126"
            />
          </Field>
          <Field label="Product line" htmlFor="batch-line-type">
            <Select
              id="batch-line-type"
              value={values.productLine}
              onChange={(e) => set("productLine", e.target.value as ProductLine)}
            >
              {(Object.keys(PRODUCT_LINE) as ProductLine[]).map((l) => (
                <option key={l} value={l}>
                  {PRODUCT_LINE[l].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Product" htmlFor="batch-product" required>
          <Input
            id="batch-product"
            value={values.product}
            onChange={(e) => set("product", e.target.value)}
            placeholder="e.g. Omeprazole 2mg/ml Oral Suspension"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantity" htmlFor="batch-qty">
            <Input
              id="batch-qty"
              type="number"
              min={0}
              inputMode="numeric"
              className="tabular"
              value={values.quantity}
              onChange={(e) => set("quantity", Number(e.target.value))}
            />
          </Field>
          <Field label="Unit" htmlFor="batch-unit">
            <Input
              id="batch-unit"
              value={values.unit}
              onChange={(e) => set("unit", e.target.value)}
              placeholder="bottles"
            />
          </Field>
          <Field label="Status" htmlFor="batch-status">
            <Select
              id="batch-status"
              value={values.status}
              onChange={(e) => set("status", e.target.value as BatchStatus)}
              disabled={!canProgress}
            >
              {(Object.keys(BATCH_STATUS) as BatchStatus[])
                .sort((a, b) => BATCH_STATUS[a].order - BATCH_STATUS[b].order)
                .map((s) => (
                  <option key={s} value={s} disabled={s === "released" && !canRelease}>
                    {BATCH_STATUS[s].label}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="batch-start" required>
            <Input
              id="batch-start"
              type="date"
              value={values.startDate}
              onChange={(e) => set("startDate", e.target.value)}
            />
          </Field>
          <Field label="End date" htmlFor="batch-end" required error={error ?? undefined}>
            <Input
              id="batch-end"
              type="date"
              value={values.endDate}
              min={values.startDate}
              onChange={(e) => set("endDate", e.target.value)}
            />
          </Field>
        </div>

        {/* ---- resources ---- */}
        <div className="grid gap-4 sm:grid-cols-3">
          {(["line", "room", "equipment"] as const).map((kind) => {
            const key = kind === "line" ? "lineId" : kind === "room" ? "roomId" : "equipmentId";
            const label = kind === "line" ? "Production line" : kind === "room" ? "Room" : "Equipment";
            return (
              <Field key={kind} label={label} htmlFor={`batch-${kind}`}>
                <Select
                  id={`batch-${kind}`}
                  value={values[key] ?? ""}
                  onChange={(e) => set(key, e.target.value || null)}
                >
                  <option value="">Not assigned</option>
                  {RESOURCES.filter((r) => r.kind === kind).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          })}
        </div>

        {/* ---- people ---- */}
        <Field
          label="Operators on this batch"
          htmlFor="batch-operators"
          helper="Select everyone working the run. Hold Ctrl (or Cmd) to choose more than one."
        >
          <select
            id="batch-operators"
            multiple
            size={4}
            value={values.operatorIds}
            onChange={(e) =>
              set(
                "operatorIds",
                Array.from(e.target.selectedOptions, (o) => o.value),
              )
            }
            className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)]
              px-2 py-1.5 text-sm text-foreground"
          >
            {operators.map((s) =>
              s ? (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.jobTitle}
                </option>
              ) : null,
            )}
          </select>
        </Field>

        <Field label="QA owner" htmlFor="batch-qa">
          <Select
            id="batch-qa"
            value={values.qaOwnerId ?? ""}
            onChange={(e) => set("qaOwnerId", e.target.value || null)}
          >
            <option value="">Not assigned</option>
            {qaStaff.map((s) =>
              s ? (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.jobTitle}
                </option>
              ) : null,
            )}
          </Select>
        </Field>

        <Field label="Notes" htmlFor="batch-notes">
          <Textarea
            id="batch-notes"
            rows={2}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Anything the next shift needs to know."
          />
        </Field>
      </fieldset>

      {/* ---- summary strip ---- */}
      {batch ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
          <BatchStatusPill status={values.status} size="sm" />
          <ProductLineTag line={values.productLine} />
          {values.lineId ? (
            <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
              {resourceById(values.lineId)?.label}
            </span>
          ) : null}
          <span className="ml-auto flex items-center gap-1.5">
            <StaffStack
              people={values.operatorIds
                .map((id) => staff.find((s) => s?.id === id))
                .filter((s): s is NonNullable<typeof s> => Boolean(s))}
            />
            {values.qaOwnerId ? (
              <span className="ml-1 flex items-center gap-1" title="QA owner">
                <Avatar
                  initials={staff.find((s) => s?.id === values.qaOwnerId)?.initials ?? "?"}
                  size={24}
                />
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </Modal>
  );
}
