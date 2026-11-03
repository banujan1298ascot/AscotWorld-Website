"use client";

/**
 * Client side of product formulas — see src/server/formulas/service.ts, and
 * src/lib/formulaRules.ts for what a formula is and how a batch's
 * quantities are worked out from it.
 */
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./apiClient";
import { useAuth } from "./auth";
import type { BaseUnit, FormulaDefinition, FormulaIngredient, OverageRule } from "./formulaRules";
import type { DosageForm } from "./products";

/** Mirrors FormulaView in src/server/formulas/service.ts. */
export interface Formula {
  id: string;
  medicineName: string;
  dosageForm: DosageForm;
  strength: string | null;
  baseUnit: BaseUnit;
  overages: OverageRule[];
  ingredients: FormulaIngredient[];
  notes: string | null;
  version: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  hasScanLayout: boolean;
}

export function useFormulas() {
  const { user } = useAuth();
  const staffId = user?.id;
  const [state, setState] = useState<{ formulas: Formula[]; canManage: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    if (!staffId) return;
    let cancelled = false;
    apiFetch<{ formulas: Formula[]; canManage: boolean }>("/api/formulas", staffId)
      .then((result) => {
        if (cancelled) return;
        setState(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load formulas.");
      });
    return () => {
      cancelled = true;
    };
  }, [staffId, reloads]);

  return {
    formulas: state?.formulas ?? [],
    canManage: state?.canManage ?? false,
    ready: state !== null || error !== null,
    error,
    refresh,
  };
}

/** Saves a new formula, or (with `id`) a change to one as its next version. */
export async function saveFormula(staffId: string, id: string | null, formula: FormulaDefinition): Promise<void> {
  await apiFetch(id ? `/api/formulas/${id}` : "/api/formulas", staffId, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(formula),
  });
}

/** Takes a formula out of use (it stays on record). */
export async function withdrawFormula(staffId: string, id: string): Promise<void> {
  await apiFetch(`/api/formulas/${id}`, staffId, { method: "DELETE" });
}
