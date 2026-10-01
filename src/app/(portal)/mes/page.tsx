"use client";

import { Suspense, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Kanban, Table } from "@phosphor-icons/react/dist/ssr";
import { MesBoard } from "@/components/mes/MesBoard";
import { MesTable } from "@/components/mes/MesTable";
import { Skeleton } from "@/components/ui";

/* ============================================================================
 * MES pipeline — one page, two views of the same live batches: the board
 * (cards dragged between columns) and the table (one editable row per
 * batch). `?view=table` picks the table, so a view can be linked to; with no
 * `view` the page opens on whichever one this browser last used.
 * ========================================================================= */

type View = "board" | "table";

const VIEW_KEY = "ascotworld:mes-view";

function readStoredView(): View | null {
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    return value === "board" || value === "table" ? value : null;
  } catch {
    return null;
  }
}

function subscribeToStoredView(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export default function MesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full" />}>
      <MesViews />
    </Suspense>
  );
}

function MesViews() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // `undefined` while rendering on the server, where there's no stored choice
  // to read yet — render nothing view-specific until the browser has it.
  const stored = useSyncExternalStore(subscribeToStoredView, readStoredView, () => undefined);

  const fromUrl = searchParams.get("view");
  const view: View | undefined =
    fromUrl === "table" || fromUrl === "board" ? fromUrl : stored === undefined ? undefined : (stored ?? "board");

  function choose(next: View) {
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private window or blocked storage — the URL still carries the choice.
    }
    router.replace(`${pathname}?view=${next}`, { scroll: false });
  }

  if (!view) return <Skeleton className="h-40 w-full" />;

  const viewSwitch = <ViewSwitch view={view} onChange={choose} />;
  return view === "table" ? <MesTable viewSwitch={viewSwitch} /> : <MesBoard viewSwitch={viewSwitch} />;
}

function ViewSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const options: { value: View; label: string; icon: typeof Table }[] = [
    { value: "board", label: "Board", icon: Kanban },
    { value: "table", label: "Table", icon: Table },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="MES view"
      className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-sunken)] p-0.5"
    >
      {options.map(({ value, label, icon: Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(value)}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-semibold transition-colors duration-150 ${
              active
                ? "bg-[var(--surface)] text-foreground shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-foreground"
            }`}
          >
            <Icon size={15} weight={active ? "fill" : "bold"} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
